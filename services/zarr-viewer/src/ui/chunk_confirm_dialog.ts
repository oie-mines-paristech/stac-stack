import {
  chunkPickerSpatialMessage,
  chunkPlanConfirmMessage,
  formatRegionLoadEstimate,
  isSpatiallyMultiChunk,
  normalizeRegion,
  planSpatialRegion,
  shouldWarnChunkPlan,
  WARN_CHUNK_COUNT,
  WARN_LOGICAL_BYTES,
  type LoadOperationPlan,
  type SpatialChunkGrid,
  type SpatialRegionPick,
} from "../chunk_plan.js";
import { warpCoastlinePathsToChunkSpace } from "../coastline_warp.js";
import type { ImageVariable } from "../dimensions.js";
import type { SpatialCoords } from "../hover.js";
import { canShowCoastlines, spatialCoordsMatchPlane } from "../spatial.js";
import { strokeWidthForViewBox } from "./svg_stroke.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PICKER_COASTLINE_STROKE_PX = 1.25;

const confirmedVariables = new Set<string>();
let pendingResolve: ((choice: ChunkLoadChoice) => void) | null = null;

export type ChunkLoadChoice =
  | { action: "proceed" }
  | { action: "dismiss" }
  | { action: "full" }
  | { action: "region"; y0: number; y1: number; x0: number; x1: number };

export function chunkConfirmDialogMarkup(): string {
  return `
    <dialog id="chunk-confirm-dialog" class="auth-dialog chunk-confirm-dialog">
      <form method="dialog" class="auth-dialog-form">
        <h2>Large data load</h2>
        <p id="chunk-confirm-message"></p>
        <div id="chunk-picker-panel" hidden>
          <p class="chunk-picker-hint muted">Click a corner, move the mouse, then click the opposite corner. Click the same cell twice for a single chunk.</p>
          <div class="chunk-picker-map-wrap">
            <svg id="chunk-picker-coastlines" class="chunk-picker-coastlines" hidden aria-hidden="true"></svg>
            <div id="chunk-picker-grid" class="chunk-picker-grid" role="grid" aria-label="Spatial chunk grid"></div>
          </div>
          <p id="chunk-picker-estimate" class="chunk-picker-estimate" hidden></p>
        </div>
        <div class="auth-dialog-actions chunk-confirm-actions">
          <button type="button" id="chunk-confirm-dismiss" class="secondary">Dismiss</button>
          <button type="button" id="chunk-confirm-continue" hidden>Continue</button>
          <button type="button" id="chunk-confirm-load-tile" hidden disabled>Load selected area</button>
        </div>
      </form>
    </dialog>
  `;
}

let committedRegion: SpatialRegionPick | null = null;
let pickerVariable: ImageVariable | null = null;
let selectionAnchor: { y: number; x: number } | null = null;

function getElements() {
  const dialog = document.querySelector<HTMLDialogElement>("#chunk-confirm-dialog");
  const messageEl = document.querySelector<HTMLParagraphElement>("#chunk-confirm-message");
  const pickerPanel = document.querySelector<HTMLDivElement>("#chunk-picker-panel");
  const pickerGrid = document.querySelector<HTMLDivElement>("#chunk-picker-grid");
  const pickerCoastlines = document.querySelector<SVGSVGElement>("#chunk-picker-coastlines");
  const estimateEl = document.querySelector<HTMLParagraphElement>("#chunk-picker-estimate");
  const dismissButton = document.querySelector<HTMLButtonElement>("#chunk-confirm-dismiss");
  const continueButton = document.querySelector<HTMLButtonElement>("#chunk-confirm-continue");
  const loadTileButton = document.querySelector<HTMLButtonElement>("#chunk-confirm-load-tile");
  if (
    !dialog ||
    !messageEl ||
    !pickerPanel ||
    !pickerGrid ||
    !pickerCoastlines ||
    !estimateEl ||
    !dismissButton ||
    !continueButton ||
    !loadTileButton
  ) {
    throw new Error("Missing chunk confirm dialog elements");
  }
  return {
    dialog,
    messageEl,
    pickerPanel,
    pickerGrid,
    pickerCoastlines,
    estimateEl,
    dismissButton,
    continueButton,
    loadTileButton,
  };
}

function finish(choice: ChunkLoadChoice): void {
  const { dialog } = getElements();
  dialog.close();
  const resolve = pendingResolve;
  pendingResolve = null;
  committedRegion = null;
  pickerVariable = null;
  selectionAnchor = null;
  resolve?.(choice);
}

function regionFromCells(
  y0: number,
  x0: number,
  y1: number,
  x1: number,
): SpatialRegionPick {
  return {
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
  };
}

function cellInRegion(y: number, x: number, region: SpatialRegionPick): boolean {
  return y >= region.y0 && y <= region.y1 && x >= region.x0 && x <= region.x1;
}

function cellFromEventTarget(target: EventTarget | null): { y: number; x: number } | null {
  const cell = (target as HTMLElement | null)?.closest?.(".chunk-picker-cell") as HTMLElement | null;
  if (!cell) return null;
  return { y: Number(cell.dataset.y), x: Number(cell.dataset.x) };
}

function applyRegionHighlight(
  pickerGrid: HTMLDivElement,
  region: SpatialRegionPick | null,
  preview: boolean,
): void {
  for (const cell of pickerGrid.querySelectorAll(".chunk-picker-cell")) {
    const el = cell as HTMLElement;
    const y = Number(el.dataset.y);
    const x = Number(el.dataset.x);
    if (preview) {
      el.classList.remove("selected");
      el.classList.toggle("in-preview", region !== null && cellInRegion(y, x, region));
    } else {
      el.classList.remove("in-preview");
      el.classList.toggle("selected", region !== null && cellInRegion(y, x, region));
    }
  }
}

function updateEstimate(region: SpatialRegionPick | null): void {
  const { estimateEl, loadTileButton } = getElements();
  if (!region || !pickerVariable) {
    estimateEl.hidden = true;
    estimateEl.textContent = "";
    estimateEl.classList.remove("chunk-picker-estimate-warn");
    loadTileButton.disabled = true;
    return;
  }

  const plan = planSpatialRegion(
    pickerVariable,
    region.y0,
    region.y1,
    region.x0,
    region.x1,
  );
  const warn = shouldWarnChunkPlan(plan);
  estimateEl.hidden = false;
  estimateEl.textContent = warn
    ? `${formatRegionLoadEstimate(plan)} — Still above recommended limits (${WARN_CHUNK_COUNT} chunks / ${WARN_LOGICAL_BYTES / (1024 * 1024)} MiB).`
    : formatRegionLoadEstimate(plan);
  estimateEl.classList.toggle("chunk-picker-estimate-warn", warn);
  loadTileButton.disabled = false;
}

function commitRegion(region: SpatialRegionPick): void {
  committedRegion = region;
  selectionAnchor = null;
  const { pickerGrid } = getElements();
  applyRegionHighlight(pickerGrid, region, false);
  updateEstimate(region);
}

function updatePreviewFromPointer(target: EventTarget | null): void {
  if (!selectionAnchor) return;
  const cell = cellFromEventTarget(target);
  const { pickerGrid } = getElements();
  if (!cell) {
    applyRegionHighlight(
      pickerGrid,
      regionFromCells(selectionAnchor.y, selectionAnchor.x, selectionAnchor.y, selectionAnchor.x),
      true,
    );
    return;
  }
  applyRegionHighlight(
    pickerGrid,
    regionFromCells(selectionAnchor.y, selectionAnchor.x, cell.y, cell.x),
    true,
  );
}

function handleCellClick(y: number, x: number): void {
  if (!selectionAnchor) {
    selectionAnchor = { y, x };
    const { pickerGrid } = getElements();
    applyRegionHighlight(pickerGrid, regionFromCells(y, x, y, x), true);
    return;
  }
  commitRegion(regionFromCells(selectionAnchor.y, selectionAnchor.x, y, x));
}

function renderPickerGrid(
  grid: SpatialChunkGrid,
  variable: ImageVariable,
  initialRegion?: SpatialRegionPick | null,
  northUp = false,
): void {
  const { pickerGrid } = getElements();
  pickerGrid.innerHTML = "";
  pickerGrid.style.gridTemplateColumns = `repeat(${grid.xChunks}, 1fr)`;
  pickerVariable = variable;
  selectionAnchor = null;
  committedRegion = initialRegion ? normalizeRegion(grid, initialRegion) : null;
  updateEstimate(committedRegion);

  for (let displayY = 0; displayY < grid.yChunks; displayY++) {
    const dataY = northUp ? grid.yChunks - 1 - displayY : displayY;
    for (let x = 0; x < grid.xChunks; x++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "chunk-picker-cell";
      cell.dataset.y = String(dataY);
      cell.dataset.x = String(x);
      cell.title = `Tile row ${dataY + 1}, column ${x + 1}`;
      cell.setAttribute("role", "gridcell");

      cell.addEventListener("click", (event) => {
        event.preventDefault();
        handleCellClick(dataY, x);
      });

      pickerGrid.appendChild(cell);
    }
  }

  if (committedRegion) {
    applyRegionHighlight(pickerGrid, committedRegion, false);
  }
}

async function renderPickerCoastlines(
  grid: SpatialChunkGrid,
  variable: ImageVariable,
  spatial: SpatialCoords | null | undefined,
): Promise<void> {
  const { pickerCoastlines, pickerGrid } = getElements();
  pickerCoastlines.replaceChildren();
  pickerCoastlines.setAttribute("hidden", "");
  pickerGrid.style.aspectRatio = `${grid.xChunks} / ${grid.yChunks}`;

  if (
    !spatial ||
    !canShowCoastlines(variable) ||
    !spatial.xValues?.length ||
    !spatial.yValues?.length ||
    !spatialCoordsMatchPlane(spatial, grid.xAxisSize, grid.yAxisSize)
  ) {
    return;
  }

  try {
    const northUp = spatial.flipY;
    const warpedPaths = await warpCoastlinePathsToChunkSpace(
      spatial.xValues,
      spatial.yValues,
      grid,
      northUp,
    );
    pickerCoastlines.removeAttribute("hidden");
    pickerCoastlines.setAttribute("viewBox", `0 0 ${grid.xChunks} ${grid.yChunks}`);
    pickerCoastlines.setAttribute("preserveAspectRatio", "none");

    pickerCoastlines.replaceChildren(
      ...warpedPaths.map((warped) => {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", warped.d);
        path.setAttribute("class", "country");
        return path;
      }),
    );
  } catch {
    pickerCoastlines.setAttribute("hidden", "");
  }
}

function applyPickerCoastlineStroke(grid: SpatialChunkGrid): void {
  const { pickerCoastlines, pickerGrid } = getElements();
  if (pickerCoastlines.hasAttribute("hidden")) return;

  const displayWidth =
    pickerCoastlines.getBoundingClientRect().width || pickerGrid.offsetWidth;
  if (displayWidth <= 0) return;

  const strokeW = strokeWidthForViewBox(
    Math.max(grid.xChunks, grid.yChunks),
    displayWidth,
    PICKER_COASTLINE_STROKE_PX,
  );
  for (const path of pickerCoastlines.querySelectorAll("path")) {
    path.setAttribute("stroke-width", String(strokeW));
  }
}

export function wireChunkConfirmDialog(): void {
  const { dismissButton, continueButton, loadTileButton, dialog, pickerGrid } = getElements();

  pickerGrid.addEventListener("pointermove", (event) => {
    updatePreviewFromPointer(event.target);
  });

  pickerGrid.addEventListener("pointerleave", () => {
    if (!selectionAnchor) return;
    applyRegionHighlight(
      pickerGrid,
      regionFromCells(
        selectionAnchor.y,
        selectionAnchor.x,
        selectionAnchor.y,
        selectionAnchor.x,
      ),
      true,
    );
  });

  dismissButton.addEventListener("click", () => finish({ action: "dismiss" }));
  continueButton.addEventListener("click", () => finish({ action: "full" }));
  loadTileButton.addEventListener("click", () => {
    if (!committedRegion) return;
    finish({
      action: "region",
      y0: committedRegion.y0,
      y1: committedRegion.y1,
      x0: committedRegion.x0,
      x1: committedRegion.x1,
    });
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish({ action: "dismiss" });
  });
}

export function resetChunkLoadConfirmations(): void {
  confirmedVariables.clear();
}

export async function promptChunkLoadChoice(
  plan: LoadOperationPlan,
  grid: SpatialChunkGrid | null,
  variablePath: string,
  variable?: ImageVariable,
  spatial?: SpatialCoords | null,
  initialRegion?: SpatialRegionPick | null,
): Promise<ChunkLoadChoice> {
  if (!shouldWarnChunkPlan(plan)) return { action: "proceed" };
  if (confirmedVariables.has(variablePath)) return { action: "full" };

  const {
    dialog,
    messageEl,
    pickerPanel,
    continueButton,
    loadTileButton,
  } = getElements();

  const multiTile = grid !== null && isSpatiallyMultiChunk(grid);

  if (multiTile && grid && variable) {
    messageEl.textContent = chunkPickerSpatialMessage(plan, grid);
    pickerPanel.hidden = false;
    continueButton.hidden = true;
    loadTileButton.hidden = false;
    renderPickerGrid(grid, variable, initialRegion, spatial?.flipY ?? false);
    await renderPickerCoastlines(grid, variable, spatial);
  } else {
    messageEl.textContent = chunkPlanConfirmMessage(plan);
    pickerPanel.hidden = true;
    pickerGridClear();
    continueButton.hidden = false;
    loadTileButton.hidden = true;
  }

  return new Promise<ChunkLoadChoice>((resolve) => {
    pendingResolve = (choice) => {
      if (choice.action === "full") confirmedVariables.add(variablePath);
      resolve(choice);
    };
    dialog.showModal();
    if (multiTile && grid) {
      requestAnimationFrame(() => applyPickerCoastlineStroke(grid));
    }
  });
}

function pickerGridClear(): void {
  const pickerGrid = document.querySelector<HTMLDivElement>("#chunk-picker-grid");
  const pickerCoastlines = document.querySelector<SVGSVGElement>("#chunk-picker-coastlines");
  const estimateEl = document.querySelector<HTMLParagraphElement>("#chunk-picker-estimate");
  if (pickerGrid) pickerGrid.innerHTML = "";
  if (pickerCoastlines) {
    pickerCoastlines.replaceChildren();
    pickerCoastlines.setAttribute("hidden", "");
  }
  if (estimateEl) {
    estimateEl.hidden = true;
    estimateEl.textContent = "";
    estimateEl.classList.remove("chunk-picker-estimate-warn");
  }
  committedRegion = null;
  pickerVariable = null;
  selectionAnchor = null;
}

/** @deprecated use promptChunkLoadChoice */
export async function confirmHeavyChunkLoad(
  plan: LoadOperationPlan,
  variablePath: string,
): Promise<boolean> {
  const choice = await promptChunkLoadChoice(plan, null, variablePath);
  return choice.action === "proceed" || choice.action === "full";
}
