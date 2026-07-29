import {
  chunkPickerSpatialMessage,
  chunkPlanConfirmMessage,
  isSpatiallyMultiChunk,
  shouldWarnChunkPlan,
  type LoadOperationPlan,
  type SpatialChunkGrid,
} from "../chunk_plan.js";

const confirmedVariables = new Set<string>();
let pendingResolve: ((choice: ChunkLoadChoice) => void) | null = null;

export type ChunkLoadChoice =
  | { action: "proceed" }
  | { action: "dismiss" }
  | { action: "full" }
  | { action: "single"; yChunk: number; xChunk: number };

export function chunkConfirmDialogMarkup(): string {
  return `
    <dialog id="chunk-confirm-dialog" class="auth-dialog chunk-confirm-dialog">
      <form method="dialog" class="auth-dialog-form">
        <h2>Large data load</h2>
        <p id="chunk-confirm-message"></p>
        <div id="chunk-picker-panel" hidden>
          <div id="chunk-picker-grid" class="chunk-picker-grid" role="grid" aria-label="Spatial chunk grid"></div>
        </div>
        <div class="auth-dialog-actions chunk-confirm-actions">
          <button type="button" id="chunk-confirm-dismiss" class="secondary">Dismiss</button>
          <button type="button" id="chunk-confirm-continue" hidden>Continue</button>
          <button type="button" id="chunk-confirm-load-tile" hidden disabled>Load a single area</button>
        </div>
      </form>
    </dialog>
  `;
}

let selectedTile: { yChunk: number; xChunk: number } | null = null;

function getElements() {
  const dialog = document.querySelector<HTMLDialogElement>("#chunk-confirm-dialog");
  const messageEl = document.querySelector<HTMLParagraphElement>("#chunk-confirm-message");
  const pickerPanel = document.querySelector<HTMLDivElement>("#chunk-picker-panel");
  const pickerGrid = document.querySelector<HTMLDivElement>("#chunk-picker-grid");
  const dismissButton = document.querySelector<HTMLButtonElement>("#chunk-confirm-dismiss");
  const continueButton = document.querySelector<HTMLButtonElement>("#chunk-confirm-continue");
  const loadTileButton = document.querySelector<HTMLButtonElement>("#chunk-confirm-load-tile");
  if (
    !dialog ||
    !messageEl ||
    !pickerPanel ||
    !pickerGrid ||
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
  selectedTile = null;
  resolve?.(choice);
}

function renderPickerGrid(grid: SpatialChunkGrid): void {
  const { pickerGrid, loadTileButton } = getElements();
  pickerGrid.innerHTML = "";
  pickerGrid.style.gridTemplateColumns = `repeat(${grid.xChunks}, 1fr)`;
  pickerGrid.style.aspectRatio = `${grid.xChunks} / ${grid.yChunks}`;
  selectedTile = null;
  loadTileButton.disabled = true;

  for (let y = 0; y < grid.yChunks; y++) {
    for (let x = 0; x < grid.xChunks; x++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "chunk-picker-cell";
      cell.dataset.y = String(y);
      cell.dataset.x = String(x);
      cell.title = `Tile row ${y + 1}, column ${x + 1}`;
      cell.setAttribute("role", "gridcell");
      cell.addEventListener("click", () => {
        for (const node of pickerGrid.querySelectorAll(".chunk-picker-cell")) {
          node.classList.remove("selected");
        }
        cell.classList.add("selected");
        selectedTile = { yChunk: y, xChunk: x };
        loadTileButton.disabled = false;
      });
      pickerGrid.appendChild(cell);
    }
  }
}

export function wireChunkConfirmDialog(): void {
  const { dismissButton, continueButton, loadTileButton, dialog } = getElements();

  dismissButton.addEventListener("click", () => finish({ action: "dismiss" }));
  continueButton.addEventListener("click", () => finish({ action: "full" }));
  loadTileButton.addEventListener("click", () => {
    if (!selectedTile) return;
    finish({
      action: "single",
      yChunk: selectedTile.yChunk,
      xChunk: selectedTile.xChunk,
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

  if (multiTile && grid) {
    messageEl.textContent = chunkPickerSpatialMessage(plan, grid);
    pickerPanel.hidden = false;
    continueButton.hidden = true;
    loadTileButton.hidden = false;
    renderPickerGrid(grid);
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
  });
}

function pickerGridClear(): void {
  const pickerGrid = document.querySelector<HTMLDivElement>("#chunk-picker-grid");
  if (pickerGrid) pickerGrid.innerHTML = "";
  selectedTile = null;
}

/** @deprecated use promptChunkLoadChoice */
export async function confirmHeavyChunkLoad(
  plan: LoadOperationPlan,
  variablePath: string,
): Promise<boolean> {
  const choice = await promptChunkLoadChoice(plan, null, variablePath);
  return choice.action === "proceed" || choice.action === "full";
}
