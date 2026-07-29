import "./style.css";
import {
  applyAuthToUrl,
  resolveStoreAuth,
  serializeBearerAuthParam,
  stripAuthFromUrl,
  type StoreAuth,
} from "./auth.js";
import { variableDisplayName, variableUnit } from "./acdd.js";
import { formatScaleInput } from "./format.js";
import {
  DEFAULT_COLORMAP,
} from "./colormap.js";
import {
  axisByRole,
  otherAxes,
  type ImageVariable,
} from "./dimensions.js";
import { canvasPixelCoords, formatHoverLine, type SpatialCoords } from "./hover.js";
import { updateHistogram } from "./histogram.js";
import {
  cancelPrefetch,
  ChunkLoadCancelledError,
  loadPlaneWithCache,
  LruPlaneCache,
  prefetchDayPlanes,
  type FrameTimings,
  type SpatialTilePick,
} from "./plane_cache.js";
import {
  spatialChunkGrid,
  tileIndexRanges,
} from "./chunk_plan.js";
import {
  autoscaleRangesFromPlane,
  countFiniteSamples,
  renderImageToCanvas,
  type ImagePlane,
  type RenderOptions,
} from "./render.js";
import { defaultRgbBands, type ScaleRange } from "./scaling.js";
import {
  openDataset,
  openVariableArray,
  preloadVariableCoordinates,
  readCoordinateValues,
  type OpenDatasetResult,
} from "./store.js";
import {
  dateRangeFromDates,
  defaultDayFromDates,
  defaultTimeIndexForDay,
  filterTimeIndicesByDay,
  formatTime,
  timeIndicesSearchOrder,
  timeValuesToDates,
} from "./time.js";
import { shouldFlipYAxis, canShowCoastlines } from "./spatial.js";
import { CorsBlockedError } from "./proxy.js";
import {
  formatChunkProgressLine,
  getChunkProgress,
  subscribeChunkProgress,
} from "./chunk_progress.js";
import { updateCoastlineOverlay } from "./ui/coastline_overlay.js";
import { updateColorLegend } from "./ui/color_legend.js";
import { mountColormapPicker, type ColormapPickerHandle } from "./ui/colormap_picker.js";
import { renderMetadataPanel, renderStatus, renderTimings } from "./ui/metadata.js";
import { authDialogMarkup, wireAuthDialog } from "./ui/auth_dialog.js";
import {
  chunkConfirmDialogMarkup,
  resetChunkLoadConfirmations,
  wireChunkConfirmDialog,
} from "./ui/chunk_confirm_dialog.js";
import { dismissErrorToast, showErrorToast } from "./ui/toast.js";
import { initPanels, wirePanels } from "./ui/panels.js";
import {
  applyDatetimeToControls,
  freshViewerParamsForStore,
  readViewerParams,
  resolveStoreUrl,
  resolveTimeIndexFromDatetime,
  sameStoreUrl,
  toDisplayStoreUrl,
  writeViewerParams,
  type ViewerUrlParams,
} from "./url_state.js";

let authDialogControls: { updateIndicator: () => void } | null = null;
let colormapPicker: ColormapPickerHandle | null = null;

interface AppState {
  dataset: OpenDatasetResult | null;
  variable: ImageVariable | null;
  auth?: StoreAuth;
  timeDates: Date[];
  timeIndices: number[];
  selection: Record<string, number>;
  rgbBands: [number, number, number];
  colormap: string;
  autoscale: boolean;
  manualScale: {
    ranges: ScaleRange[];
    locked: boolean;
    needsSeed: boolean;
  };
  spatialCoords: SpatialCoords | null;
  spatialTile: SpatialTilePick | null;
  currentPlane: ImagePlane | null;
  scaleRange: { min: number; max: number } | null;
  isPlaying: boolean;
  renderGeneration: number;
  fillView: boolean;
  showCoastlines: boolean;
}

const state: AppState = {
  dataset: null,
  variable: null,
  timeDates: [],
  timeIndices: [],
  selection: {},
  rgbBands: [0, 1, 2],
  colormap: DEFAULT_COLORMAP,
  autoscale: true,
  manualScale: { ranges: [], locked: false, needsSeed: false },
  spatialCoords: null,
  spatialTile: null,
  currentPlane: null,
  scaleRange: null,
  isPlaying: false,
  renderGeneration: 0,
  fillView: false,
  showCoastlines: true,
};

const PLAYBACK_INTERVAL_MS = 500;

let suppressSliderEvent = false;
const planeCache = new LruPlaneCache(128);
let loadingStatusPrefix = "";

function refreshLoadingStatus(): void {
  if (!loadingStatusPrefix) return;
  const status = el<HTMLParagraphElement>("#status");
  renderStatus(
    status,
    formatChunkProgressLine(getChunkProgress(), loadingStatusPrefix),
  );
}

function setLoadingStatus(prefix: string): void {
  loadingStatusPrefix = prefix;
  refreshLoadingStatus();
}

function clearLoadingStatus(): void {
  loadingStatusPrefix = "";
}

function formatTimings(timings: FrameTimings): string {
  if (timings.cacheHit) {
    return `cache hit · render ${timings.renderMs.toFixed(0)} ms`;
  }
  return `fetch ${timings.fetchMs.toFixed(0)} ms · render ${timings.renderMs.toFixed(0)} ms`;
}

function variableDataUnit(): string | undefined {
  return state.variable ? variableUnit(state.variable.attributes) : undefined;
}

function refreshHistogram(): void {
  if (!state.variable) return;
  const bandAxis = axisByRole(state.variable, "band");
  const mode = displayMode(state.variable);
  const rgbIndices = mode === "rgb" ? [...state.rgbBands] : null;
  const domain =
    mode === "scalar" && state.scaleRange ? state.scaleRange : null;
  updateHistogram(
    el<HTMLCanvasElement>("#histogram"),
    state.currentPlane,
    bandAxis?.coordinate?.labels,
    rgbIndices,
    domain,
    variableDataUnit(),
  );
}

function fitCanvasDisplay(canvas: HTMLCanvasElement): void {
  const wrap = el<HTMLDivElement>("#canvas-wrap");
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return;

  if (state.fillView) {
    const scale = Math.min(wrap.clientWidth / width, wrap.clientHeight / height);
    canvas.style.width = `${Math.floor(width * scale)}px`;
    canvas.style.height = `${Math.floor(height * scale)}px`;
  } else {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  updateZoomButton();
  syncCoastlineOverlay(canvas);
}

function syncCoastlineOverlay(canvas: HTMLCanvasElement): void {
  const overlay = document.querySelector<SVGSVGElement>("#coastline-overlay");
  const show = state.variable ? canShowCoastlines(state.variable) : false;
  updateCoastlineOverlay(
    overlay,
    canvas,
    effectiveSpatialCoords(),
    show && state.showCoastlines,
    state.currentPlane,
  );
}

function updateCoastlineControlVisibility(): void {
  const row = document.querySelector<HTMLElement>("#coastline-control");
  if (!row) return;
  const visible = state.variable ? canShowCoastlines(state.variable) : false;
  row.hidden = !visible;
  if (!visible) {
    const checkbox = document.querySelector<HTMLInputElement>("#show-coastlines");
    if (checkbox) checkbox.checked = false;
    state.showCoastlines = false;
  }
}

function updateZoomButton(): void {
  const button = el<HTMLButtonElement>("#btn-zoom");
  button.classList.toggle("active", state.fillView);
  button.textContent = state.fillView ? "1:1" : "⛶";
  button.setAttribute(
    "aria-label",
    state.fillView ? "Show image at native pixel size" : "Zoom image to fill view",
  );
  button.title = state.fillView ? "Native size (1:1 pixels)" : "Zoom to fill available area";
}

function toggleFillView(): void {
  state.fillView = !state.fillView;
  fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
  pushViewerUrl();
}

function effectiveSpatialCoords(): SpatialCoords | null {
  if (!state.spatialCoords || !state.spatialTile || !state.variable) {
    return state.spatialCoords;
  }
  const grid = spatialChunkGrid(state.variable);
  if (!grid) return state.spatialCoords;
  const ranges = tileIndexRanges(grid, state.spatialTile.yChunk, state.spatialTile.xChunk);
  const { xValues, yValues, ...rest } = state.spatialCoords;
  return {
    ...rest,
    xValues: xValues ? xValues.slice(ranges.x[0], ranges.x[1]) : null,
    yValues: yValues ? yValues.slice(ranges.y[0], ranges.y[1]) : null,
  };
}

function planeLoadOptions() {
  return {
    spatialTile: state.spatialTile,
    setSpatialTile: (tile: SpatialTilePick | null) => {
      state.spatialTile = tile;
    },
  };
}

function spatialTileStatusHtml(): string {
  if (!state.spatialTile || !state.variable) return "";
  const grid = spatialChunkGrid(state.variable);
  if (!grid) return "";
  const { yChunk, xChunk } = state.spatialTile;
  return (
    `Showing spatial tile ${yChunk + 1}/${grid.yChunks} × ${xChunk + 1}/${grid.xChunks}. ` +
    `<button type="button" id="change-spatial-area" class="link-button">Change area…</button>`
  );
}

async function changeSpatialArea(): Promise<void> {
  if (!state.spatialTile) return;
  state.spatialTile = null;
  clearFrameCache();
  await renderCurrentFrame();
}

function clearFrameCache(): void {
  planeCache.clear();
  cancelPrefetch();
}

function schedulePrefetch(): void {
  if (!state.dataset || !state.variable || state.spatialTile) return;
  const timeAxis = axisByRole(state.variable, "time");
  if (!timeAxis || state.timeIndices.length === 0) return;

  const generation = state.renderGeneration;
  const variable = state.variable;
  const selection = { ...state.selection };
  const mode = displayMode(variable);
  const timeIndices = [...state.timeIndices];

  void openVariableArray(state.dataset.root, variable).then((arr) =>
    prefetchDayPlanes({
      arr,
      variable,
      mode,
      selection,
      timeAxisName: timeAxis.name,
      timeIndices,
      cache: planeCache,
      generation,
      spatialTile: state.spatialTile,
      isCurrentGeneration: () => generation === state.renderGeneration,
    }),
  );
}

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node as T;
}

const IDLE_MESSAGE =
  "Enter a store URL in the field above, or open the viewer with a shared link (#…).";

function reportError(error: unknown): void {
  const message =
    error instanceof CorsBlockedError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  showErrorToast(message);
  renderStatus(el<HTMLParagraphElement>("#status"), "");
}

function showIdleState(): void {
  dismissErrorToast();
  const urlInput = el<HTMLInputElement>("#url-input");
  urlInput.value = "";
  urlInput.removeAttribute("value");
  el<HTMLDivElement>("#viewer-idle").hidden = false;
  renderStatus(el<HTMLParagraphElement>("#status"), IDLE_MESSAGE);
  el<HTMLParagraphElement>("#timings").textContent = "";
}

function hideIdleState(): void {
  el<HTMLDivElement>("#viewer-idle").hidden = true;
}

function defaultSelection(variable: ImageVariable): Record<string, number> {
  const values: Record<string, number> = {};
  for (const axis of variable.axes) {
    values[axis.name] = 0;
  }
  return values;
}

function stopAnimation(): void {
  state.isPlaying = false;
  updatePlayPauseButton();
}

function displayMode(variable: ImageVariable): "rgb" | "scalar" {
  const bandAxis = axisByRole(variable, "band");
  return bandAxis && bandAxis.size >= 3 ? "rgb" : "scalar";
}

function renderOptions(variable: ImageVariable): RenderOptions {
  return {
    mode: displayMode(variable),
    rgbBands: state.rgbBands,
    autoscale: state.autoscale,
    attributes: variable.attributes,
    flipY: effectiveSpatialCoords()?.flipY ?? false,
    colormap: state.colormap,
    manualRanges: state.autoscale ? undefined : state.manualScale.ranges,
  };
}

function bandCountForVariable(variable: ImageVariable): number {
  const bandAxis = axisByRole(variable, "band");
  return bandAxis?.size ?? 1;
}

function seedManualScaleFromCurrentFrame(): void {
  if (!state.variable || !state.currentPlane) return;
  state.manualScale.ranges = autoscaleRangesFromPlane(
    state.currentPlane,
    effectiveSpatialCoords()?.flipY ?? false,
    state.variable.attributes,
  );
  state.manualScale.needsSeed = false;
  state.manualScale.locked = true;
  buildScaleControls(state.variable);
}

function commitManualScaleFromInputs(
  band: number,
  minInput: HTMLInputElement,
  maxInput: HTMLInputElement,
): boolean {
  const min = Number(minInput.value);
  const max = Number(maxInput.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return false;
  state.manualScale.ranges[band] = { min, max };
  state.manualScale.needsSeed = false;
  state.manualScale.locked = true;
  pushViewerUrl();
  void renderCurrentFrame();
  return true;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

function buildScaleControls(variable: ImageVariable): void {
  const container = el<HTMLDivElement>("#scale-controls");
  const bandAxis = axisByRole(variable, "band");
  const bandCount = bandCountForVariable(variable);
  const labels = bandAxis?.coordinate?.labels;
  const visible = !state.autoscale && state.manualScale.ranges.length > 0;

  container.hidden = !visible;
  container.innerHTML = "";
  if (!visible) return;

  if (state.manualScale.ranges.length > bandCount) {
    state.manualScale.ranges = state.manualScale.ranges.slice(0, bandCount);
  }

  for (let band = 0; band < bandCount; band++) {
    const row = document.createElement("div");
    row.className = "scale-band-row";

    const label = document.createElement("span");
    label.className = "scale-band-label";
    label.textContent =
      labels?.[band] ?? (bandCount === 1 ? "min/max" : `band ${band}`);

    const range = state.manualScale.ranges[band];
    if (!range) continue;

    const minInput = document.createElement("input");
    minInput.type = "text";
    minInput.inputMode = "decimal";
    minInput.className = "scale-input";
    minInput.placeholder = "min";
    minInput.dataset.band = String(band);
    minInput.dataset.bound = "min";
    minInput.value = formatScaleInput(range.min);

    const maxInput = document.createElement("input");
    maxInput.type = "text";
    maxInput.inputMode = "decimal";
    maxInput.className = "scale-input";
    maxInput.placeholder = "max";
    maxInput.dataset.band = String(band);
    maxInput.dataset.bound = "max";
    maxInput.value = formatScaleInput(range.max);

    const commit = () => commitManualScaleFromInputs(band, minInput, maxInput);
    const commitDebounced = debounce(commit, 300);

    minInput.addEventListener("change", commit);
    maxInput.addEventListener("change", commit);
    minInput.addEventListener("input", commitDebounced);
    maxInput.addEventListener("input", commitDebounced);

    row.append(label, minInput, maxInput);
    container.appendChild(row);
  }
}

function pushViewerUrl(): void {
  if (!state.dataset || !state.variable) return;
  writeViewerParams({
    storeUrl: state.dataset.schema.url,
    auth: state.auth,
    variable: state.variable,
    timeDates: state.timeDates,
    selection: state.selection,
    rgbBands: state.rgbBands,
    colormap: state.colormap,
    autoscale: state.autoscale,
    manualScale: state.autoscale ? [] : state.manualScale.ranges,
    fillView: state.fillView,
  });
}

function refreshTimeIndices(): void {
  const dateInput = el<HTMLInputElement>("#date-picker");
  state.timeIndices = filterTimeIndicesByDay(state.timeDates, dateInput.value);
  syncTimeSlider();
}

function syncTimeSlider(): void {
  const slider = el<HTMLInputElement>("#time-slider");
  const label = el<HTMLSpanElement>("#time-label");
  const timeAxis = state.variable ? axisByRole(state.variable, "time") : undefined;

  if (!timeAxis || state.timeIndices.length === 0) {
    slider.disabled = true;
    slider.min = "0";
    slider.max = "0";
    suppressSliderEvent = true;
    slider.value = "0";
    suppressSliderEvent = false;
    label.textContent = "No time steps";
    return;
  }

  slider.disabled = false;
  slider.min = "0";
  slider.max = String(Math.max(0, state.timeIndices.length - 1));
  const current = state.selection[timeAxis.name] ?? state.timeIndices[0];
  let position = state.timeIndices.indexOf(current);
  if (position < 0) position = 0;
  suppressSliderEvent = true;
  slider.value = String(position);
  suppressSliderEvent = false;

  const date = state.timeDates[current] ?? new Date(0);
  label.textContent = `${formatTime(date)} UTC · step ${position + 1}/${state.timeIndices.length} · idx ${current}`;
}

function setTimeSliderPosition(position: number): void {
  const timeAxis = state.variable ? axisByRole(state.variable, "time") : undefined;
  if (!timeAxis || state.timeIndices.length === 0) return;
  const clamped = Math.max(0, Math.min(position, state.timeIndices.length - 1));
  state.selection[timeAxis.name] = state.timeIndices[clamped];
  syncTimeSlider();
}

function updatePlayPauseButton(): void {
  const button = el<HTMLButtonElement>("#btn-play-pause");
  button.textContent = state.isPlaying ? "⏸" : "▶";
  button.setAttribute("aria-label", state.isPlaying ? "Pause" : "Play");
}

function syncRgbSelects(): void {
  if (displayMode(state.variable!) !== "rgb") return;
  el<HTMLSelectElement>("#band-r").value = String(state.rgbBands[0]);
  el<HTMLSelectElement>("#band-g").value = String(state.rgbBands[1]);
  el<HTMLSelectElement>("#band-b").value = String(state.rgbBands[2]);
}

async function loadSpatialCoords(
  dataset: OpenDatasetResult,
  variable: ImageVariable,
): Promise<void> {
  const xAxis = axisByRole(variable, "x");
  const yAxis = axisByRole(variable, "y");
  const [xValues, yValues] = await Promise.all([
    xAxis?.coordinate
      ? readCoordinateValues(dataset.root, xAxis.coordinate.path).then(toNumbers)
      : Promise.resolve(null),
    yAxis?.coordinate
      ? readCoordinateValues(dataset.root, yAxis.coordinate.path).then(toNumbers)
      : Promise.resolve(null),
  ]);
  const yAttrs = yAxis?.coordinate?.attributes ?? {};
  const flipY = shouldFlipYAxis(yValues, yAttrs);
  state.spatialCoords = {
    xName: xAxis?.name ?? "x",
    yName: yAxis?.name ?? "y",
    xValues,
    yValues,
    flipY,
  };
}

function toNumbers(values: unknown[]): number[] {
  return values.map((value) =>
    typeof value === "bigint" ? Number(value) : Number(value),
  );
}

function buildOtherDimControls(variable: ImageVariable): void {
  const container = el<HTMLDivElement>("#other-dims");
  container.innerHTML = "";
  for (const axis of otherAxes(variable)) {
    const wrapper = document.createElement("label");
    wrapper.className = "control";
    const select = document.createElement("select");
    select.dataset.axis = axis.name;
    for (let i = 0; i < axis.size; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      const label = axis.coordinate?.labels?.[i];
      option.textContent = label ? `${i}: ${label}` : `${axis.name} = ${i}`;
      select.appendChild(option);
    }
    select.value = String(state.selection[axis.name] ?? 0);
    select.addEventListener("change", () => {
      state.selection[axis.name] = Number(select.value);
      clearFrameCache();
      void renderCurrentFrame();
    });
    wrapper.textContent = `${axis.name} `;
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  }
}

function buildVariableSelect(schema: OpenDatasetResult["schema"]): void {
  const select = el<HTMLSelectElement>("#variable-select");
  select.innerHTML = "";
  for (const variable of schema.variables) {
    const option = document.createElement("option");
    option.value = variable.path;
    const display = variableDisplayName(variable.attributes, variable.path);
    const dims = variable.dimensionNames.join(", ");
    option.textContent =
      display !== variable.path ? `${display} [${dims}]` : `${variable.path} [${dims}]`;
    select.appendChild(option);
  }
}

function updateColormapPickerSelection(): void {
  colormapPicker?.setSelected(state.colormap);
}

function buildColorControls(variable: ImageVariable): void {
  const rgbBands = el<HTMLDivElement>("#rgb-bands");
  const colormapRow = el<HTMLDivElement>("#colormap-row");
  const bandAxis = axisByRole(variable, "band");
  const mode = displayMode(variable);
  rgbBands.hidden = mode !== "rgb" || !bandAxis;
  colormapRow.hidden = mode !== "scalar";

  if (mode === "scalar") {
    const pickerHost = el<HTMLDivElement>("#colormap-picker");
    if (!colormapPicker) {
      colormapPicker = mountColormapPicker(pickerHost, state.colormap, (name) => {
        state.colormap = name;
        void renderCurrentFrame();
      });
    } else {
      updateColormapPickerSelection();
    }
    updateColorLegend(true, state.colormap, 0, 1, variableDataUnit());
    buildScaleControls(variable);
    return;
  }

  updateColorLegend(false, state.colormap, 0, 1);
  if (rgbBands.hidden || !bandAxis) return;

  const labels = bandAxis.coordinate?.labels;
  state.rgbBands = defaultRgbBands(labels, bandAxis.size);

  for (const [channel, selectId] of [
    ["R", "#band-r"],
    ["G", "#band-g"],
    ["B", "#band-b"],
  ] as const) {
    const select = el<HTMLSelectElement>(selectId);
    select.innerHTML = "";
    for (let i = 0; i < bandAxis.size; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      const label = labels?.[i];
      option.textContent = label ? `${label} (${i})` : `${bandAxis.name} ${i}`;
      select.appendChild(option);
    }
    const index = channel === "R" ? 0 : channel === "G" ? 1 : 2;
    select.value = String(state.rgbBands[index]);
    select.onchange = () => {
      state.rgbBands[index] = Number(select.value);
      void renderCurrentFrame();
    };
  }
  buildScaleControls(variable);
}

async function loadTimeCoordinate(dataset: OpenDatasetResult, variable: ImageVariable): Promise<void> {
  const timeAxis = axisByRole(variable, "time");
  if (!timeAxis?.coordinate) {
    state.timeDates = [];
    state.timeIndices = [];
    el<HTMLFieldSetElement>("#time-controls").hidden = true;
    return;
  }

  el<HTMLFieldSetElement>("#time-controls").hidden = false;
  const attrs = timeAxis.coordinate.attributes;
  const units = typeof attrs.units === "string" ? attrs.units : "";
  const values = await readCoordinateValues(dataset.root, timeAxis.coordinate.path);
  state.timeDates = timeValuesToDates(values, units);

  const dateInput = el<HTMLInputElement>("#date-picker");
  const range = dateRangeFromDates(state.timeDates);
  dateInput.min = range.min;
  dateInput.max = range.max;
  dateInput.value = defaultDayFromDates(state.timeDates);

  refreshTimeIndices();
  if (state.timeIndices.length > 0) {
    state.selection[timeAxis.name] = defaultTimeIndexForDay(state.timeIndices);
    syncTimeSlider();
  }
}

function applyViewerParams(params: ViewerUrlParams): void {
  if (params.autoscale !== undefined) {
    state.autoscale = params.autoscale;
    el<HTMLInputElement>("#autoscale").checked = params.autoscale;
    state.manualScale.locked = !params.autoscale;
    if (params.autoscale) {
      state.manualScale.ranges = [];
      state.manualScale.needsSeed = false;
    }
  } else if (!params.manualScale?.length) {
    state.autoscale = true;
    el<HTMLInputElement>("#autoscale").checked = true;
    state.manualScale = { ranges: [], locked: false, needsSeed: false };
  }

  if (params.manualScale && params.manualScale.length > 0) {
    state.manualScale.ranges = params.manualScale;
    state.manualScale.needsSeed = false;
    state.manualScale.locked = true;
    if (state.variable) buildScaleControls(state.variable);
  }

  if (params.fillView !== undefined) {
    state.fillView = params.fillView;
    updateZoomButton();
  }

  if (params.rgb) {
    state.rgbBands = params.rgb;
    syncRgbSelects();
  }

  if (params.colormap) {
    state.colormap = params.colormap;
    updateColormapPickerSelection();
  }

  if (params.datetime && state.timeDates.length > 0 && state.variable) {
    const timeIndex = resolveTimeIndexFromDatetime(state.timeDates, params.datetime);
    const timeAxis = axisByRole(state.variable, "time");
    if (timeIndex !== undefined && timeAxis) {
      applyDatetimeToControls(state.timeDates, timeIndex, el<HTMLInputElement>("#date-picker"));
      refreshTimeIndices();
      state.selection[timeAxis.name] = timeIndex;
      syncTimeSlider();
    }
  }

  if (state.variable) {
    for (const axis of otherAxes(state.variable)) {
      if (params.dims[axis.name] !== undefined) {
        state.selection[axis.name] = params.dims[axis.name];
      }
    }
    buildOtherDimControls(state.variable);
  }
}

async function selectVariable(path: string): Promise<void> {
  if (!state.dataset) return;
  const variable = state.dataset.schema.variables.find((item) => item.path === path);
  if (!variable) return;
  stopAnimation();
  clearFrameCache();
  state.spatialTile = null;
  state.variable = variable;
  state.selection = defaultSelection(variable);
  state.manualScale = { ranges: [], locked: false, needsSeed: !state.autoscale };
  buildOtherDimControls(variable);
  buildColorControls(variable);
  updateCoastlineControlVisibility();
  await preloadVariableCoordinates(state.dataset.root, variable);
  await Promise.all([
    loadTimeCoordinate(state.dataset, variable),
    loadSpatialCoords(state.dataset, variable),
  ]);
  renderMetadataPanel(el<HTMLElement>("#metadata"), state.dataset.schema, variable, state.auth);
  el<HTMLSelectElement>("#variable-select").value = path;
  syncCoastlineOverlay(el<HTMLCanvasElement>("#canvas"));
}

async function loadPlaneWithFiniteFallback(
  arr: Awaited<ReturnType<typeof openVariableArray>>,
  variable: ImageVariable,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): Promise<{ plane: ImagePlane; timings: FrameTimings; usedFallback: boolean }> {
  if (!state.dataset) {
    throw new Error("Dataset not loaded");
  }
  const schema = state.dataset.schema;
  const timeAxis = axisByRole(variable, "time");
  let { plane, timings } = await loadPlaneWithCache(
    planeCache,
    arr,
    variable,
    schema,
    selection,
    mode,
    planeLoadOptions(),
  );
  if (countFiniteSamples(plane) > 0 || !timeAxis || state.timeIndices.length === 0) {
    return { plane, timings, usedFallback: false };
  }

  const currentTime = selection[timeAxis.name];
  const candidates = timeIndicesSearchOrder(state.timeIndices).filter(
    (index) => index !== currentTime,
  );

  for (const timeIndex of candidates) {
    const trySelection = { ...selection, [timeAxis.name]: timeIndex };
    const result = await loadPlaneWithCache(
      planeCache,
      arr,
      variable,
      schema,
      trySelection,
      mode,
      planeLoadOptions(),
    );
    if (countFiniteSamples(result.plane) > 0) {
      state.selection[timeAxis.name] = timeIndex;
      syncTimeSlider();
      return { plane: result.plane, timings: result.timings, usedFallback: true };
    }
  }

  return { plane, timings, usedFallback: false };
}

async function renderCurrentFrame(options?: { quiet?: boolean }): Promise<FrameTimings | null> {
  if (!state.dataset || !state.variable) return null;
  const generation = ++state.renderGeneration;
  const status = el<HTMLParagraphElement>("#status");
  const timingsEl = el<HTMLParagraphElement>("#timings");
  if (!options?.quiet) setLoadingStatus("Loading…");

  try {
    const arr = await openVariableArray(state.dataset.root, state.variable);
    const options_ = renderOptions(state.variable);
    const { plane, timings, usedFallback } = await loadPlaneWithFiniteFallback(
      arr,
      state.variable,
      state.selection,
      options_.mode,
    );
    if (generation !== state.renderGeneration) return null;

    if (countFiniteSamples(plane) === 0) {
      showErrorToast(
        "Aucune valeur valide à cet instant — essayez un autre pas ou une autre date.",
      );
    } else if (usedFallback) {
      showErrorToast(
        "Aucune valeur valide à cet instant — affichage d'un pas voisin.",
      );
    }

    state.currentPlane = plane;
    hideIdleState();
    const canvas = el<HTMLCanvasElement>("#canvas");
    if (!state.autoscale && state.manualScale.needsSeed && !state.manualScale.locked) {
      state.manualScale.ranges = autoscaleRangesFromPlane(
        plane,
        effectiveSpatialCoords()?.flipY ?? false,
        state.variable.attributes,
      );
      state.manualScale.needsSeed = false;
      state.manualScale.locked = true;
      buildScaleControls(state.variable);
    }
    const renderStart = performance.now();
    const { scaleMin, scaleMax } = renderImageToCanvas(
      canvas,
      plane,
      renderOptions(state.variable),
    );
    timings.renderMs = performance.now() - renderStart;
    state.scaleRange = { min: scaleMin, max: scaleMax };
    const mode = displayMode(state.variable);
    const unit = variableDataUnit();
    updateColorLegend(mode === "scalar", state.colormap, scaleMin, scaleMax, unit);
    fitCanvasDisplay(canvas);
    refreshHistogram();
    syncTimeSlider();
    clearLoadingStatus();
    const tileStatus = spatialTileStatusHtml();
    if (tileStatus) {
      status.innerHTML = tileStatus;
      status.querySelector<HTMLButtonElement>("#change-spatial-area")?.addEventListener(
        "click",
        () => {
          void changeSpatialArea();
        },
        { once: true },
      );
    } else {
      renderStatus(status, "");
    }
    if (countFiniteSamples(plane) > 0 && !usedFallback) {
      dismissErrorToast();
    }
    renderTimings(timingsEl, formatTimings(timings));
    pushViewerUrl();
    schedulePrefetch();
    return timings;
  } catch (error) {
    if (generation !== state.renderGeneration) return null;
    clearLoadingStatus();
    if (error instanceof ChunkLoadCancelledError) {
      renderStatus(status, "");
      renderTimings(timingsEl, "");
      return null;
    }
    renderTimings(timingsEl, "");
    reportError(error);
    return null;
  }
}

function stepTime(delta: number): void {
  const variable = state.variable;
  if (!variable) return;
  const timeAxis = axisByRole(variable, "time");
  if (!timeAxis || state.timeIndices.length === 0) return;
  const current = state.selection[timeAxis.name] ?? state.timeIndices[0];
  let position = state.timeIndices.indexOf(current);
  if (position < 0) position = 0;
  position = (position + delta + state.timeIndices.length) % state.timeIndices.length;
  state.selection[timeAxis.name] = state.timeIndices[position];
  syncTimeSlider();
}

async function runAnimation(): Promise<void> {
  const variable = state.variable;
  if (!variable) return;
  const timeAxis = axisByRole(variable, "time");
  if (!timeAxis || state.timeIndices.length < 2) return;

  updatePlayPauseButton();
  while (state.isPlaying && state.timeIndices.length >= 2) {
    stepTime(1);
    await renderCurrentFrame({ quiet: true });
    if (!state.isPlaying) break;

    const deadline = performance.now() + PLAYBACK_INTERVAL_MS;
    while (state.isPlaying && performance.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }
  updatePlayPauseButton();
}

function togglePlayback(): void {
  if (state.isPlaying) {
    stopAnimation();
    return;
  }
  if (state.timeIndices.length < 2) return;
  state.isPlaying = true;
  void runAnimation();
}

function mountLayout(): void {
  const app = el<HTMLDivElement>("#app");
  app.innerHTML = `
    <div class="layout">
      <header>
        <h1>Zarr Image Viewer</h1>
        <div class="url-row url-control">
          <button type="button" id="auth-btn" class="auth-btn" title="Authentication">🔑</button>
          <input
            id="url-input"
            type="text"
            name="zarr-store-url"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Store URL (https://… or /path/to/store.zarr/)"
            value=""
          />
        </div>
      </header>
      ${authDialogMarkup()}
      ${chunkConfirmDialogMarkup()}
      <div id="error-toast" class="error-toast" role="alert" hidden></div>
      <div class="body" id="body-grid">
        <aside class="panel-left sidebar" id="panel-left">
          <div class="panel-header">
            <button type="button" id="toggle-left" class="panel-toggle" title="Hide controls panel">◀</button>
          </div>
          <div class="panel-scroll">
          <label class="control">
            Variable
            <select id="variable-select"></select>
          </label>
          <fieldset id="time-controls">
            <legend>Time</legend>
            <label class="control">
              Date (UTC)
              <input id="date-picker" type="date" />
            </label>
            <div class="time-scrubber">
              <button type="button" id="btn-play-pause" aria-label="Play">▶</button>
              <input id="time-slider" type="range" min="0" max="0" value="0" />
              <span id="time-label" class="time-label"></span>
            </div>
          </fieldset>
          <details class="sidebar-section" id="color-controls" open>
            <summary>Colors</summary>
            <div id="rgb-bands" class="rgb-row" hidden>
              <label>R <select id="band-r"></select></label>
              <label>G <select id="band-g"></select></label>
              <label>B <select id="band-b"></select></label>
            </div>
            <div id="colormap-row" class="colormap-row" hidden>
              <span class="control-label">Colormap</span>
              <div id="colormap-picker"></div>
            </div>
            <div id="scale-controls" class="scale-controls" hidden></div>
            <label class="control checkbox">
              <input id="autoscale" type="checkbox" checked />
              Autoscale (P5–P95)
            </label>
            <label class="control checkbox" id="coastline-control" hidden>
              <input id="show-coastlines" type="checkbox" checked />
              Coastline overlay
            </label>
          </details>
          <div id="other-dims"></div>
          <p id="timings" class="muted"></p>
          <p id="status" class="muted"></p>
          </div>
        </aside>
        <div class="splitter" id="splitter-left" aria-hidden="true"></div>
        <main class="stage">
          <button type="button" id="dock-left" class="dock-toggle" hidden title="Show controls panel">▶</button>
          <button type="button" id="dock-right" class="dock-toggle" hidden title="Show metadata panel">◀</button>
          <div class="stage-inner">
            <div class="image-view">
              <div id="canvas-wrap" class="canvas-wrap">
                <div id="viewer-idle" class="viewer-idle">
                  <p>${IDLE_MESSAGE}</p>
                </div>
                <button type="button" id="btn-zoom" class="canvas-tool" aria-label="Zoom image to fill view">⛶</button>
                <div class="canvas-stack">
                  <canvas id="canvas"></canvas>
                  <svg id="coastline-overlay" class="coastline-overlay" hidden preserveAspectRatio="none" aria-hidden="true"></svg>
                </div>
              </div>
              <aside id="color-legend" class="color-legend" hidden>
                <canvas id="color-legend-bar"></canvas>
                <div class="color-legend-ticks">
                  <span id="legend-max"></span>
                  <span id="legend-mid"></span>
                  <span id="legend-min"></span>
                </div>
              </aside>
            </div>
            <p id="hover-bar" class="hover-bar">&nbsp;</p>
          </div>
        </main>
        <div class="splitter" id="splitter-right" aria-hidden="true"></div>
        <aside class="panel-right metadata" id="panel-right">
          <div class="panel-header">
            <button type="button" id="toggle-right" class="panel-toggle" title="Hide metadata panel">▶</button>
          </div>
          <div class="panel-scroll">
            <div id="metadata"></div>
            <section class="histogram-section">
              <h3>Histogram</h3>
              <canvas id="histogram" class="histogram-canvas"></canvas>
            </section>
          </div>
        </aside>
      </div>
    </div>
  `;
}

async function loadViewer(params: ViewerUrlParams): Promise<void> {
  if (!params.storeUrl.trim()) {
    state.auth = undefined;
    showIdleState();
    return;
  }

  hideIdleState();
  stopAnimation();
  state.auth = params.auth;
  el<HTMLInputElement>("#url-input").value = toDisplayStoreUrl(params.storeUrl, params.auth);
  authDialogControls?.updateIndicator();
  renderStatus(el<HTMLParagraphElement>("#status"), "Opening store…");
  resetChunkLoadConfirmations();
  state.spatialTile = null;
  try {
    state.dataset = await openDataset(params.storeUrl, params.auth);
    buildVariableSelect(state.dataset.schema);

    const requested = params.variable;
    const hasRequested =
      requested !== undefined &&
      state.dataset.schema.variables.some((item) => item.path === requested);
    const defaultVariable =
      (hasRequested ? requested : undefined) ??
      state.dataset.schema.variables.find((item) => item.path === "radiance")?.path ??
      state.dataset.schema.variables[0]?.path;

    if (defaultVariable) {
      await selectVariable(defaultVariable);
      applyViewerParams(params);
      await renderCurrentFrame();
    }
  } catch (error) {
    reportError(error);
  }
}

function wireCanvasHover(): void {
  const canvas = el<HTMLCanvasElement>("#canvas");
  const hoverBar = el<HTMLParagraphElement>("#hover-bar");

  canvas.addEventListener("mousemove", (event) => {
    if (!state.currentPlane || !state.variable) return;
    const pixel = canvasPixelCoords(canvas, event.clientX, event.clientY);
    if (!pixel) return;
    const bandAxis = axisByRole(state.variable, "band");
    hoverBar.textContent = formatHoverLine(
      state.currentPlane,
      pixel.x,
      pixel.y,
      effectiveSpatialCoords(),
      bandAxis?.coordinate?.labels,
      variableDataUnit(),
    );
  });

  canvas.addEventListener("mouseleave", () => {
    hoverBar.innerHTML = "&nbsp;";
  });
}

function wireEvents(): void {
  el<HTMLInputElement>("#url-input").addEventListener("change", (event) => {
    const url = (event.target as HTMLInputElement).value.trim();
    const resolved = url ? resolveStoreUrl(url) : "";
    const bearerParam =
      state.auth?.kind === "bearer" ? serializeBearerAuthParam(state.auth) : null;
    const auth = resolved ? resolveStoreAuth(resolved, bearerParam) : undefined;
    void loadViewer(freshViewerParamsForStore(resolved, auth));
  });

  el<HTMLSelectElement>("#variable-select").addEventListener("change", (event) => {
    void (async () => {
      await selectVariable((event.target as HTMLSelectElement).value);
      await renderCurrentFrame();
    })();
  });

  el<HTMLInputElement>("#date-picker").addEventListener("change", () => {
    stopAnimation();
    clearFrameCache();
    refreshTimeIndices();
    const timeAxis = state.variable ? axisByRole(state.variable, "time") : undefined;
    if (timeAxis && state.timeIndices.length > 0) {
      state.selection[timeAxis.name] = defaultTimeIndexForDay(state.timeIndices);
    }
    void renderCurrentFrame();
  });

  el<HTMLInputElement>("#time-slider").addEventListener("input", (event) => {
    if (suppressSliderEvent) return;
    stopAnimation();
    setTimeSliderPosition(Number((event.target as HTMLInputElement).value));
    void renderCurrentFrame();
  });

  el<HTMLButtonElement>("#btn-play-pause").addEventListener("click", () => togglePlayback());

  el<HTMLButtonElement>("#btn-zoom").addEventListener("click", () => toggleFillView());

  el<HTMLInputElement>("#autoscale").addEventListener("change", (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    state.autoscale = checked;
    if (!checked) {
      state.manualScale.needsSeed = false;
      seedManualScaleFromCurrentFrame();
      pushViewerUrl();
    } else {
      state.manualScale.locked = false;
      state.manualScale.needsSeed = false;
      state.manualScale.ranges = [];
      if (state.variable) buildScaleControls(state.variable);
    }
    void renderCurrentFrame();
  });

  el<HTMLInputElement>("#show-coastlines").addEventListener("change", (event) => {
    state.showCoastlines = (event.target as HTMLInputElement).checked;
    syncCoastlineOverlay(el<HTMLCanvasElement>("#canvas"));
  });

  window.addEventListener("resize", () => {
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
  });
}

async function main(): Promise<void> {
  subscribeChunkProgress(() => refreshLoadingStatus());
  mountLayout();
  initPanels();
  wireChunkConfirmDialog();
  authDialogControls = wireAuthDialog({
    getStoreUrl: () =>
      el<HTMLInputElement>("#url-input").value.trim() || readViewerParams().storeUrl,
    getAuth: () => state.auth,
    onSave: (storeUrl, auth) => {
      const resolved = resolveStoreUrl(storeUrl);
      const nextUrl =
        auth?.kind === "basic"
          ? applyAuthToUrl(stripAuthFromUrl(resolved), auth)
          : stripAuthFromUrl(resolved);
      const currentStore = state.dataset?.schema.url;
      const params =
        currentStore && sameStoreUrl(currentStore, nextUrl)
          ? { ...readViewerParams(), storeUrl: nextUrl, auth }
          : freshViewerParamsForStore(nextUrl, auth);
      void loadViewer(params);
    },
  });
  wireEvents();
  wirePanels(() => {
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
    refreshHistogram();
  });
  wireCanvasHover();
  const params = readViewerParams();
  if (params.storeUrl) {
    await loadViewer(params);
  } else {
    showIdleState();
  }
}

void main();
