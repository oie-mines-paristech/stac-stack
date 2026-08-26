import "./style.css";
import {
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
import { updateHistogram, type HistogramScaleMarker } from "./histogram.js";
import {
  cancelPrefetch,
  ChunkLoadCancelledError,
  loadPlaneWithCache,
  LruPlaneCache,
  prefetchDayPlanes,
  prefetchOtherDimValues,
  type FrameTimings,
  type LoadPlaneOptions,
  type SpatialRegionPick,
} from "./plane_cache.js";
import {
  normalizeRegion,
  planLoadOperation,
  planSpatialRegion,
  spatialChunkGrid,
  regionIndexRanges,
  isSpatiallyMultiChunk,
} from "./chunk_plan.js";
import {
  autoscaleRangesFromPlane,
  canvasToPlanePixel,
  computeViewLayout,
  countFiniteSamples,
  ensurePlaneBandStats,
  planeHasDisplayableData,
  resolveChannelRangeTuples,
  type DisplayTransform,
  type ImagePlane,
  type RenderOptions,
} from "./render.js";
import { renderPlaneToView } from "./render_pipeline.js";
import { defaultRgbBands, defaultManualRangesForDtype, defaultScaleModeForDtype, type ScaleMode, type ScaleRange } from "./scaling.js";
import {
  connectStore,
  openVariableArray,
  preloadVariableCoordinates,
  readCoordinateValues,
  getCachedCoordinateValues,
  type OpenDatasetResult,
} from "./store.js";
import {
  dateRangeFromDates,
  defaultDayFromDatesLast,
  defaultTimeIndexForAxis,
  filterTimeIndicesByDay,
  formatTimeStepLabel,
  inferTimeStepMs,
  shiftUtcDate,
  supportsIntraDayTimePlayback,
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
import { wireViewPan, type ViewPanController } from "./ui/canvas_pan.js";
import { updateColorLegend } from "./ui/color_legend.js";
import { mountColormapPicker, type ColormapPickerHandle } from "./ui/colormap_picker.js";
import { renderMetadataPanel, renderStatus, renderTimings } from "./ui/metadata.js";
import { connectDialogMarkup, wireConnectDialog } from "./ui/connect_dialog.js";
import {
  chunkConfirmDialogMarkup,
  promptChunkLoadChoice,
  resetChunkLoadConfirmations,
  wireChunkConfirmDialog,
} from "./ui/chunk_confirm_dialog.js";
import { dismissErrorToast, showErrorToast } from "./ui/toast.js";
import { initPanels, initResponsivePanelMode, setFullTabMode, wirePanels } from "./ui/panels.js";
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

let connectDialogControls: { open: () => void } | null = null;
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
  scaleMode: ScaleMode;
  manualScale: {
    ranges: ScaleRange[];
    locked: boolean;
    needsSeed: boolean;
  };
  spatialCoords: SpatialCoords | null;
  spatialRegion: SpatialRegionPick | null;
  currentPlane: ImagePlane | null;
  displayTransform: DisplayTransform | null;
  viewOrigin: { x: number; y: number };
  scaleRange: { min: number; max: number } | null;
  lastRenderedScaleRanges: ScaleRange[];
  isPlaying: boolean;
  renderGeneration: number;
  fillView: boolean;
  fullTabMode: boolean;
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
  scaleMode: "percentile",
  manualScale: { ranges: [], locked: false, needsSeed: false },
  spatialCoords: null,
  spatialRegion: null,
  currentPlane: null,
  displayTransform: null,
  viewOrigin: { x: 0, y: 0 },
  scaleRange: null,
  lastRenderedScaleRanges: [],
  isPlaying: false,
  renderGeneration: 0,
  fillView: false,
  fullTabMode: false,
  showCoastlines: true,
};

const PLAYBACK_INTERVAL_MS = 500;

let suppressSliderEvent = false;
const planeCache = new LruPlaneCache(128);
let viewPan: ViewPanController | null = null;

function commitViewOrigin(origin: { x: number; y: number }): void {
  if (origin.x === state.viewOrigin.x && origin.y === state.viewOrigin.y) return;
  state.viewOrigin = origin;
  if (state.currentPlane && state.variable) {
    void renderCurrentFrame({ quiet: true });
  }
}
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
  if (state.isPlaying) {
    return `frame ${timings.frameMs.toFixed(0)} ms (render ${timings.renderMs.toFixed(0)} ms)`;
  }
  if (timings.cacheHit) {
    const parts = [`cache hit · render ${timings.renderMs.toFixed(0)} ms`];
    if (timings.statsMs > 0) parts.push(`stats ${timings.statsMs.toFixed(0)} ms`);
    if (timings.histogramMs > 0) parts.push(`hist ${timings.histogramMs.toFixed(0)} ms`);
    return parts.join(" · ");
  }
  const parts = [
    `fetch ${timings.fetchMs.toFixed(0)} ms`,
    `render ${timings.renderMs.toFixed(0)} ms`,
  ];
  if (timings.statsMs > 0) parts.push(`stats ${timings.statsMs.toFixed(0)} ms`);
  if (timings.histogramMs > 0) parts.push(`hist ${timings.histogramMs.toFixed(0)} ms`);
  return parts.join(" · ");
}

function publishFrameProfile(timings: FrameTimings): void {
  (window as unknown as { __viewerFrameProfile?: FrameTimings }).__viewerFrameProfile = timings;
}

function variableDataUnit(): string | undefined {
  return state.variable ? variableUnit(state.variable.attributes) : undefined;
}

function refreshHistogram(): void {
  if (state.isPlaying) return;
  if (!state.variable) return;
  const bandAxis = axisByRole(state.variable, "band");
  const mode = displayMode(state.variable);
  const rgbIndices = mode === "rgb" ? [...state.rgbBands] : null;
  const labels = bandAxis?.coordinate?.labels;
  const markers: HistogramScaleMarker[] = [];
  if (mode === "rgb" && state.lastRenderedScaleRanges.length > 0) {
    for (let channel = 0; channel < state.rgbBands.length; channel++) {
      const bandIndex = state.rgbBands[channel];
      const range = state.lastRenderedScaleRanges[channel];
      if (!range) continue;
      const label = labels?.[bandIndex] ?? `band ${bandIndex}`;
      markers.push({
        label,
        color: histogramMarkerColor(label, bandIndex),
        min: range.min,
        max: range.max,
      });
    }
  } else if (state.lastRenderedScaleRanges[0]) {
    markers.push({
      label: "value",
      color: "rgba(200, 200, 200, 0.9)",
      min: state.lastRenderedScaleRanges[0].min,
      max: state.lastRenderedScaleRanges[0].max,
    });
  }

  const plane = state.currentPlane;
  const canvas = el<HTMLCanvasElement>("#histogram");
  if (!plane) {
    updateHistogram(canvas, null, labels, rgbIndices, markers, variableDataUnit());
    return;
  }

  updateHistogram(canvas, plane, labels, rgbIndices, markers, variableDataUnit());
}

function histogramMarkerColor(label: string, index: number): string {
  const lower = label.toLowerCase();
  if (lower === "r" || lower === "red") return "rgba(231, 76, 60, 0.95)";
  if (lower === "g" || lower === "g1" || lower === "green") return "rgba(46, 204, 113, 0.95)";
  if (lower === "b" || lower === "blue") return "rgba(52, 152, 219, 0.95)";
  if (lower === "g2") return "rgba(26, 188, 156, 0.95)";
  const palette = ["#e74c3c", "#2ecc71", "#3498db", "#9b59b6"];
  return palette[index % palette.length]!;
}

function fitCanvasDisplay(canvas: HTMLCanvasElement): void {
  const wrap = el<HTMLDivElement>("#canvas-wrap");
  const width = canvas.width;
  const height = canvas.height;
  if (width <= 0 || height <= 0) return;

  if (state.currentPlane) {
    const planeWidth = state.currentPlane.shape[state.currentPlane.axes.x];
    const planeHeight = state.currentPlane.shape[state.currentPlane.axes.y];
    canvas.dataset.planeWidth = String(planeWidth);
    canvas.dataset.planeHeight = String(planeHeight);
  }

  if (state.fillView) {
    const scale = Math.min(wrap.clientWidth / width, wrap.clientHeight / height);
    canvas.style.width = `${Math.floor(width * scale)}px`;
    canvas.style.height = `${Math.floor(height * scale)}px`;
  } else {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  const stack = canvas.parentElement;
  if (stack) stack.style.transform = "";

  updateZoomButton();
  syncCoastlineOverlay(canvas);
  viewPan?.sync();
}

function viewLayoutForPlane(plane: ImagePlane) {
  const wrap = el<HTMLDivElement>("#canvas-wrap");
  return computeViewLayout(
    plane.shape[plane.axes.x],
    plane.shape[plane.axes.y],
    wrap.clientWidth,
    wrap.clientHeight,
    state.fillView,
    state.viewOrigin,
  );
}

function syncCoastlineOverlay(canvas: HTMLCanvasElement): void {
  const overlay = document.querySelector<SVGSVGElement>("#coastline-overlay");
  const show = state.variable ? canShowCoastlines(state.variable) : false;
  void updateCoastlineOverlay(
    overlay,
    canvas,
    effectiveSpatialCoords(),
    show && state.showCoastlines,
    state.currentPlane,
    state.displayTransform,
  ).catch(() => {
    // Coastline fetch/parse failure is non-fatal for the viewer.
  });
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
  state.viewOrigin = { x: 0, y: 0 };
  viewPan?.reset();
  pushViewerUrl();
  if (state.currentPlane && state.variable) {
    void renderCurrentFrame();
    return;
  }
  fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
}

function effectiveSpatialCoords(): SpatialCoords | null {
  if (!state.spatialCoords || !state.spatialRegion || !state.variable) {
    return state.spatialCoords;
  }
  const grid = spatialChunkGrid(state.variable);
  if (!grid) return state.spatialCoords;
  const ranges = regionIndexRanges(
    grid,
    state.spatialRegion.y0,
    state.spatialRegion.y1,
    state.spatialRegion.x0,
    state.spatialRegion.x1,
  );
  const { xValues, yValues, ...rest } = state.spatialCoords;
  return {
    ...rest,
    xValues: xValues ? xValues.slice(ranges.x[0], ranges.x[1]) : null,
    yValues: yValues ? yValues.slice(ranges.y[0], ranges.y[1]) : null,
  };
}

function planeLoadOptions(): LoadPlaneOptions {
  return {
    spatialRegion: state.spatialRegion,
    setSpatialRegion: (region: SpatialRegionPick | null) => {
      state.spatialRegion = region;
    },
    spatialCoords: state.spatialCoords,
  };
}

function spatialRegionStatusHtml(): string {
  if (!state.spatialRegion || !state.variable) return "";
  const grid = spatialChunkGrid(state.variable);
  if (!grid) return "";
  const { y0, y1, x0, x1 } = state.spatialRegion;
  const plan = planSpatialRegion(state.variable, y0, y1, x0, x1);
  const chunkLabel = plan.imageChunks === 1 ? "1 chunk" : `${plan.imageChunks} chunks`;
  return (
    `Showing spatial region rows ${y0 + 1}–${y1 + 1} × cols ${x0 + 1}–${x1 + 1} (${chunkLabel}). ` +
    `<button type="button" id="change-spatial-area" class="link-button">Change area…</button>`
  );
}

async function changeSpatialArea(): Promise<void> {
  if (!state.spatialRegion || !state.variable || !state.dataset) return;
  const grid = spatialChunkGrid(state.variable);
  if (!grid || !isSpatiallyMultiChunk(grid)) return;

  const variable = state.variable;
  const previous = { ...state.spatialRegion };
  const cachedCoordPaths = new Set<string>();
  for (const axis of variable.axes) {
    const path = axis.coordinate?.path;
    if (path && getCachedCoordinateValues(path) !== undefined) {
      cachedCoordPaths.add(path);
    }
  }
  const plan = planLoadOperation({
    variable,
    selection: state.selection,
    mode: displayMode(variable),
    schema: state.dataset.schema,
    cachedCoordPaths,
  });

  const choice = await promptChunkLoadChoice(
    plan,
    grid,
    variable.path,
    variable,
    state.spatialCoords,
    previous,
  );

  if (choice.action === "dismiss") return;
  if (choice.action === "region") {
    state.spatialRegion = normalizeRegion(grid, {
      y0: choice.y0,
      y1: choice.y1,
      x0: choice.x0,
      x1: choice.x1,
    });
  } else if (choice.action === "full") {
    state.spatialRegion = null;
  }
  clearFrameCache();
  await renderCurrentFrame();
}

function retainSpatialRegionForVariable(variable: ImageVariable): void {
  if (!state.spatialRegion) return;
  const grid = spatialChunkGrid(variable);
  if (!grid) {
    state.spatialRegion = null;
    return;
  }
  state.spatialRegion = normalizeRegion(grid, state.spatialRegion);
}

function clearFrameCache(): void {
  planeCache.clear();
  cancelPrefetch();
}

function schedulePrefetch(): void {
  if (!state.dataset || !state.variable || state.spatialRegion) return;
  const timeAxis = axisByRole(state.variable, "time");
  if (!timeAxis || state.timeIndices.length === 0) return;

  const generation = state.renderGeneration;
  const variable = state.variable;
  const selection = { ...state.selection };
  const mode = displayMode(variable);
  const timeIndices = [...state.timeIndices];
  const otherDimAxes = otherAxes(variable).map((axis) => ({
    name: axis.name,
    size: axis.size,
  }));

  void openVariableArray(state.dataset.root, variable).then((arr) => {
    const ctx = {
      arr,
      variable,
      mode,
      selection,
      timeAxisName: timeAxis.name,
      timeIndices,
      cache: planeCache,
      generation,
      spatialRegion: state.spatialRegion,
      isCurrentGeneration: () => generation === state.renderGeneration,
    };
    void prefetchDayPlanes(ctx);
    if (otherDimAxes.length > 0) {
      void prefetchOtherDimValues({ ...ctx, otherAxes: otherDimAxes });
    }
  });
}

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node as T;
}

const IDLE_MESSAGE = "No dataset loaded.";
const NO_DATA_MESSAGE = "No data at this time";

interface LoadViewerOptions {
  dataset?: OpenDatasetResult;
}

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

function updateHoverBarIdle(): void {
  const hoverBar = document.querySelector<HTMLParagraphElement>("#hover-bar");
  if (!hoverBar) return;
  hoverBar.textContent = state.variable?.path ?? "";
}

function showIdleState(): void {
  dismissErrorToast();
  state.dataset = null;
  state.variable = null;
  hideCanvasNoData();
  el<HTMLDivElement>("#viewer-idle").hidden = false;
  renderStatus(el<HTMLParagraphElement>("#status"), IDLE_MESSAGE);
  el<HTMLParagraphElement>("#timings").textContent = "";
  updateDatasetLabel("");
  updateTimeControlsVisibility();
  const hoverBar = document.querySelector<HTMLParagraphElement>("#hover-bar");
  if (hoverBar) hoverBar.textContent = "";
}

function hideIdleState(): void {
  el<HTMLDivElement>("#viewer-idle").hidden = true;
}

function showCanvasNoData(): void {
  el<HTMLDivElement>("#canvas-no-data").hidden = false;
}

function hideCanvasNoData(): void {
  el<HTMLDivElement>("#canvas-no-data").hidden = true;
}

function paintEmptyCanvas(canvas: HTMLCanvasElement, plane: ImagePlane): void {
  const width = plane.shape[plane.axes.x];
  const height = plane.shape[plane.axes.y];
  if (width > 0 && height > 0) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (ctx && canvas.width > 0 && canvas.height > 0) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  fitCanvasDisplay(canvas);
  syncCoastlineOverlay(canvas);
}

function updateDatasetLabel(storeUrl: string, auth?: StoreAuth): void {
  const label = document.querySelector<HTMLSpanElement>("#dataset-url");
  if (!label) return;
  const display = storeUrl.trim() ? toDisplayStoreUrl(storeUrl, auth) : "";
  label.textContent = display || "—";
  label.title = display;
}

function updateLayoutButton(): void {
  const button = el<HTMLButtonElement>("#btn-layout");
  button.classList.toggle("active", state.fullTabMode);
  button.textContent = state.fullTabMode ? "☰" : "⤢";
  button.title = state.fullTabMode ? "Show sidebars" : "Full tab view";
  button.setAttribute(
    "aria-label",
    state.fullTabMode ? "Show sidebars" : "Full tab view",
  );
}

function toggleFullTabMode(): void {
  state.fullTabMode = !state.fullTabMode;
  setFullTabMode(state.fullTabMode, () => {
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
    refreshHistogram();
  });
  updateLayoutButton();
  pushViewerUrl();
}

function applyFullTabFromParams(fullTab?: boolean): void {
  if (fullTab === undefined) return;
  state.fullTabMode = fullTab;
  setFullTabMode(fullTab, () => {
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
    refreshHistogram();
  });
  updateLayoutButton();
}

function updateTimeControlsVisibility(): void {
  const controls = document.querySelector<HTMLElement>("#playback-controls");
  if (!controls) return;
  const timeAxis = state.variable ? axisByRole(state.variable, "time") : undefined;
  controls.hidden = !timeAxis;
  updateTimeScrubberVisibility();
}

function updateTimeScrubberVisibility(): void {
  const scrubber = document.querySelector<HTMLElement>(".time-scrubber");
  if (!scrubber) return;
  const show = state.timeDates.length > 0 && supportsIntraDayTimePlayback(state.timeDates);
  scrubber.hidden = !show;
  if (!show) stopAnimation();
}

function onDateChanged(): void {
  stopAnimation();
  clearFrameCache();
  refreshTimeIndices();
  const timeAxis = state.variable ? axisByRole(state.variable, "time") : undefined;
  if (timeAxis && state.timeIndices.length > 0) {
    state.selection[timeAxis.name] = defaultTimeIndexForAxis(
      state.timeDates,
      state.timeIndices,
    );
  }
  void renderCurrentFrame();
}

function openDatePicker(): void {
  const datePicker = el<HTMLInputElement>("#date-picker");
  if (typeof datePicker.showPicker === "function") {
    datePicker.showPicker();
    return;
  }
  datePicker.focus();
}

function shiftDate(days: number): void {
  const datePicker = el<HTMLInputElement>("#date-picker");
  if (!datePicker.value) return;
  datePicker.value = shiftUtcDate(datePicker.value, days);
  onDateChanged();
}

function defaultSelection(variable: ImageVariable): Record<string, number> {
  const values: Record<string, number> = {};
  for (const axis of variable.axes) {
    values[axis.name] = 0;
  }
  return values;
}

function stopAnimation(): void {
  const wasPlaying = state.isPlaying;
  state.isPlaying = false;
  updatePlayPauseButton();
  if (wasPlaying) {
    refreshHistogram();
    pushViewerUrl();
  }
}

function preferScalarDisplay(variable: ImageVariable): boolean {
  const path = variable.path.toLowerCase();
  if (path.endsWith("_mask") || path.includes("mask")) return true;
  const standardName = variable.attributes.standard_name;
  if (typeof standardName === "string" && standardName.toLowerCase().includes("mask")) {
    return true;
  }
  return false;
}

function displayMode(variable: ImageVariable): "rgb" | "scalar" {
  if (preferScalarDisplay(variable)) return "scalar";
  const bandAxis = axisByRole(variable, "band");
  return bandAxis && bandAxis.size >= 3 ? "rgb" : "scalar";
}

function planeIsDisplayable(plane: ImagePlane): boolean {
  return state.variable
    ? planeHasDisplayableData(plane, state.variable.dtype)
    : countFiniteSamples(plane) > 0;
}

function renderOptions(variable: ImageVariable): RenderOptions {
  return {
    mode: displayMode(variable),
    rgbBands: state.rgbBands,
    scaleMode: state.scaleMode,
    attributes: variable.attributes,
    flipY: effectiveSpatialCoords()?.flipY ?? false,
    colormap: state.colormap,
    manualRanges: state.scaleMode === "none" ? state.manualScale.ranges : undefined,
  };
}

function seedManualScaleFromCurrentFrame(): void {
  if (!state.variable || !state.currentPlane) return;
  const bandAxis = axisByRole(state.variable, "band");
  const bandCount = bandAxis?.size ?? 1;
  const defaults = defaultManualRangesForDtype(state.variable.dtype, bandCount);
  if (defaults.length > 0) {
    state.manualScale.ranges = defaults;
  } else if (state.lastRenderedScaleRanges.length > 0) {
    state.manualScale.ranges = state.lastRenderedScaleRanges.map((range) => ({
      min: range.min,
      max: range.max,
    }));
  } else {
    state.manualScale.ranges = autoscaleRangesFromPlane(
      state.currentPlane,
      effectiveSpatialCoords()?.flipY ?? false,
      state.variable.attributes,
      "minmax",
      state.variable.dtype,
      displayMode(state.variable),
      state.rgbBands,
    );
  }
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
  const labels = bandAxis?.coordinate?.labels;
  const mode = displayMode(variable);
  const visible = state.scaleMode === "none" && state.manualScale.ranges.length > 0;

  container.hidden = !visible;
  container.innerHTML = "";
  if (!visible) return;

  const rows =
    mode === "rgb"
      ? state.rgbBands.map((bandIndex, channel) => ({
          channel,
          label: labels?.[bandIndex] ?? `band ${bandIndex}`,
        }))
      : [{ channel: 0, label: labels?.[0] ?? "min/max" }];

  for (const row of rows) {
    const range = state.manualScale.ranges[row.channel];
    if (!range) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "scale-band-row";

    const label = document.createElement("span");
    label.className = "scale-band-label";
    label.textContent = row.label;

    const minInput = document.createElement("input");
    minInput.type = "text";
    minInput.inputMode = "decimal";
    minInput.className = "scale-input";
    minInput.placeholder = "min";
    minInput.dataset.band = String(row.channel);
    minInput.dataset.bound = "min";
    minInput.value = formatScaleInput(range.min);

    const maxInput = document.createElement("input");
    maxInput.type = "text";
    maxInput.inputMode = "decimal";
    maxInput.className = "scale-input";
    maxInput.placeholder = "max";
    maxInput.dataset.band = String(row.channel);
    maxInput.dataset.bound = "max";
    maxInput.value = formatScaleInput(range.max);

    const commit = () => commitManualScaleFromInputs(row.channel, minInput, maxInput);
    const commitDebounced = debounce(commit, 300);

    minInput.addEventListener("change", commit);
    maxInput.addEventListener("change", commit);
    minInput.addEventListener("input", commitDebounced);
    maxInput.addEventListener("input", commitDebounced);

    wrapper.append(label, minInput, maxInput);
    container.appendChild(wrapper);
  }
}

function syncScaleModeSelect(): void {
  el<HTMLSelectElement>("#scale-mode").value = state.scaleMode;
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
    scaleMode: state.scaleMode,
    manualScale: state.scaleMode === "none" ? state.manualScale.ranges : [],
    fillView: state.fillView,
    fullTab: state.fullTabMode,
    spatialRegion: state.spatialRegion,
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
    label.textContent = "";
    updateTimeControlsVisibility();
    return;
  }

  updateTimeControlsVisibility();

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
  label.textContent = formatTimeStepLabel(date, inferTimeStepMs(state.timeDates));
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
      ? readCoordinateValues(dataset.root, xAxis.coordinate.path, xAxis.coordinate).then(toNumbers)
      : Promise.resolve(null),
    yAxis?.coordinate
      ? readCoordinateValues(dataset.root, yAxis.coordinate.path, yAxis.coordinate).then(toNumbers)
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

async function loadTimeCoordinate(
  dataset: OpenDatasetResult,
  variable: ImageVariable,
  options?: { preferredTimeIndex?: number },
): Promise<void> {
  const timeAxis = axisByRole(variable, "time");
  if (!timeAxis?.coordinate) {
    state.timeDates = [];
    state.timeIndices = [];
    updateTimeControlsVisibility();
    return;
  }

  updateTimeControlsVisibility();
  const attrs = timeAxis.coordinate.attributes;
  const units = typeof attrs.units === "string" ? attrs.units : "";
  const values = await readCoordinateValues(
    dataset.root,
    timeAxis.coordinate.path,
    timeAxis.coordinate,
  );
  state.timeDates = timeValuesToDates(values, units);

  const dateInput = el<HTMLInputElement>("#date-picker");
  const range = dateRangeFromDates(state.timeDates);
  dateInput.min = range.min;
  dateInput.max = range.max;

  const preferred = options?.preferredTimeIndex;
  if (
    preferred !== undefined &&
    preferred >= 0 &&
    preferred < state.timeDates.length
  ) {
    applyDatetimeToControls(state.timeDates, preferred, dateInput);
    refreshTimeIndices();
    state.selection[timeAxis.name] = preferred;
    syncTimeSlider();
    return;
  }

  dateInput.value = defaultDayFromDatesLast(state.timeDates);

  refreshTimeIndices();
  if (state.timeIndices.length > 0) {
    state.selection[timeAxis.name] = defaultTimeIndexForAxis(
      state.timeDates,
      state.timeIndices,
    );
    syncTimeSlider();
  }
}

function applyViewerParams(params: ViewerUrlParams): void {
  if (params.scaleMode !== undefined) {
    state.scaleMode = params.scaleMode;
    syncScaleModeSelect();
    state.manualScale.locked = params.scaleMode === "none";
    if (params.scaleMode !== "none") {
      state.manualScale.ranges = [];
      state.manualScale.needsSeed = false;
    } else {
      state.manualScale.needsSeed = false;
      if (!params.manualScale?.length && state.variable) {
        const bandAxis = axisByRole(state.variable, "band");
        state.manualScale.ranges = defaultManualRangesForDtype(
          state.variable.dtype,
          bandAxis?.size ?? 1,
        );
      }
    }
    if (state.variable) buildScaleControls(state.variable);
  } else if (!params.manualScale?.length) {
    state.scaleMode = state.variable
      ? defaultScaleModeForDtype(state.variable.dtype)
      : "percentile";
    syncScaleModeSelect();
    state.manualScale = {
      ranges: [],
      locked: state.scaleMode === "none",
      needsSeed: state.scaleMode === "none",
    };
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

  applyFullTabFromParams(params.fullTab);

  if (params.rgb) {
    state.rgbBands = params.rgb;
    syncRgbSelects();
  }

  if (params.colormap) {
    state.colormap = params.colormap;
    updateColormapPickerSelection();
  }

  if (params.spatialRegion) {
    state.spatialRegion = { ...params.spatialRegion };
  } else {
    state.spatialRegion = null;
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

async function selectVariable(
  path: string,
  options?: { preferredTimeIndex?: number },
): Promise<void> {
  if (!state.dataset) return;
  const variable = state.dataset.schema.variables.find((item) => item.path === path);
  if (!variable) return;
  stopAnimation();
  clearFrameCache();
  state.variable = variable;
  el<HTMLSelectElement>("#variable-select").value = path;
  updateTimeControlsVisibility();
  retainSpatialRegionForVariable(variable);
  state.selection = defaultSelection(variable);
  state.scaleMode = defaultScaleModeForDtype(variable.dtype);
  syncScaleModeSelect();
  const bandAxis = axisByRole(variable, "band");
  state.manualScale = {
    ranges: defaultManualRangesForDtype(variable.dtype, bandAxis?.size ?? 1),
    locked: state.scaleMode === "none",
    needsSeed: false,
  };
  buildOtherDimControls(variable);
  buildColorControls(variable);
  updateCoastlineControlVisibility();
  await preloadVariableCoordinates(state.dataset.root, variable);
  await Promise.all([
    loadTimeCoordinate(state.dataset, variable, {
      preferredTimeIndex: options?.preferredTimeIndex,
    }),
    loadSpatialCoords(state.dataset, variable),
  ]);
  renderMetadataPanel(el<HTMLElement>("#metadata"), state.dataset.schema, variable, state.auth);
  syncCoastlineOverlay(el<HTMLCanvasElement>("#canvas"));
  updateHoverBarIdle();
}

async function renderCurrentFrame(options?: { quiet?: boolean }): Promise<FrameTimings | null> {
  if (!state.dataset || !state.variable) return null;
  const generation = ++state.renderGeneration;
  const status = el<HTMLParagraphElement>("#status");
  const timingsEl = el<HTMLParagraphElement>("#timings");
  if (!options?.quiet) setLoadingStatus("Loading…");

  try {
    const arr = await openVariableArray(state.dataset.root, state.variable);
    const renderOpts = renderOptions(state.variable);
    const { plane, timings } = await loadPlaneWithCache(
      planeCache,
      arr,
      state.variable,
      state.dataset.schema,
      state.selection,
      renderOpts.mode,
      planeLoadOptions(),
    );
    if (generation !== state.renderGeneration) return null;

    const displayable = planeIsDisplayable(plane);
    dismissErrorToast();
    hideIdleState();
    const canvas = el<HTMLCanvasElement>("#canvas");

    if (!displayable) {
      state.currentPlane = null;
      state.displayTransform = null;
      state.scaleRange = null;
      state.lastRenderedScaleRanges = [];
      showCanvasNoData();
      paintEmptyCanvas(canvas, plane);
      el<HTMLElement>("#color-legend").hidden = true;
      refreshHistogram();
      syncTimeSlider();
      clearLoadingStatus();
      renderStatus(status, "");
      renderTimings(timingsEl, formatTimings(timings));
      timings.frameMs = timings.fetchMs + timings.postUiMs;
      publishFrameProfile(timings);
      if (!state.isPlaying) {
        pushViewerUrl();
      }
      updateHoverBarIdle();
      return timings;
    }

    hideCanvasNoData();
    state.currentPlane = plane;
    if (state.scaleMode === "none" && state.manualScale.needsSeed && !state.manualScale.locked) {
      const bandAxis = axisByRole(state.variable, "band");
      const defaults = defaultManualRangesForDtype(
        state.variable.dtype,
        bandAxis?.size ?? 1,
      );
      if (defaults.length > 0) {
        state.manualScale.ranges = defaults;
      } else {
        state.manualScale.ranges = autoscaleRangesFromPlane(
          plane,
          effectiveSpatialCoords()?.flipY ?? false,
          state.variable.attributes,
          "minmax",
          state.variable.dtype,
          displayMode(state.variable),
          state.rgbBands,
        );
      }
      state.manualScale.needsSeed = false;
      state.manualScale.locked = true;
      buildScaleControls(state.variable);
    }
    const statsLevel = state.isPlaying ? "minmax" : "full";
    const statsStart = performance.now();
    const channelRanges = resolveChannelRangeTuples(
      plane,
      renderOpts,
      state.variable.dtype,
      plane.bandStats,
      statsLevel,
    );
    timings.statsMs = performance.now() - statsStart;
    const renderStart = performance.now();
    const layout = viewLayoutForPlane(plane);
    state.viewOrigin = {
      x: layout.displayTransform.regionX0,
      y: layout.displayTransform.regionY0,
    };
    const { scaleMin, scaleMax, displayTransform } = await renderPlaneToView(
      canvas,
      plane,
      renderOpts,
      layout,
      { dtype: state.variable.dtype, channelRanges },
    );
    timings.renderMs = performance.now() - renderStart;
    state.displayTransform = displayTransform;
    state.scaleRange = { min: scaleMin, max: scaleMax };
    state.lastRenderedScaleRanges = channelRanges.map(([min, max]) => ({ min, max }));
    const mode = displayMode(state.variable);
    const unit = variableDataUnit();
    updateColorLegend(mode === "scalar", state.colormap, scaleMin, scaleMax, unit);
    const postStart = performance.now();
    fitCanvasDisplay(canvas);
    const histogramStart = performance.now();
    if (!state.isPlaying) {
      ensurePlaneBandStats(plane, "full");
    }
    refreshHistogram();
    timings.histogramMs = performance.now() - histogramStart;
    syncTimeSlider();
    clearLoadingStatus();
    timings.postUiMs = performance.now() - postStart;
    timings.frameMs =
      timings.fetchMs + timings.statsMs + timings.renderMs + timings.postUiMs;
    publishFrameProfile(timings);
    const tileStatus = spatialRegionStatusHtml();
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
    renderTimings(timingsEl, formatTimings(timings));
    if (!state.isPlaying) {
      pushViewerUrl();
    }
    schedulePrefetch();
    updateHoverBarIdle();
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
  refreshHistogram();
  pushViewerUrl();
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
      ${connectDialogMarkup()}
      ${chunkConfirmDialogMarkup()}
      <div id="error-toast" class="error-toast" role="alert" hidden></div>
      <div class="body" id="body-grid">
        <aside class="panel-left sidebar" id="panel-left">
          <div class="panel-header">
            <button type="button" id="toggle-left" class="panel-toggle" title="Hide controls panel">◀</button>
          </div>
          <div class="panel-scroll">
          <div class="dataset-row">
            <span class="dataset-label">Dataset</span>
            <span id="dataset-url" class="dataset-url muted" title="">—</span>
            <button type="button" id="btn-dataset-change" title="Change dataset" aria-label="Change dataset">📂</button>
          </div>
          <label class="control">
            Variable
            <select id="variable-select"></select>
          </label>
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
            <label class="control">
              Scale range
              <select id="scale-mode">
                <option value="percentile" selected>Auto (P5–P95)</option>
                <option value="minmax">Min–max</option>
                <option value="none">None (manual / CF)</option>
              </select>
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
              <aside id="color-legend" class="color-legend" hidden>
                <span id="legend-min" class="color-legend-end"></span>
                <canvas id="color-legend-bar"></canvas>
                <span id="legend-max" class="color-legend-end"></span>
              </aside>
              <div id="canvas-wrap" class="canvas-wrap">
                <div id="viewer-idle" class="viewer-idle">
                  <p>${IDLE_MESSAGE}</p>
                </div>
                <div class="canvas-tools">
                  <button type="button" id="btn-zoom" class="canvas-tool" aria-label="Zoom image to fill view">⛶</button>
                </div>
                <div class="canvas-stack">
                  <canvas id="canvas"></canvas>
                  <div id="canvas-no-data" class="canvas-no-data" hidden aria-live="polite">
                    <p>${NO_DATA_MESSAGE}</p>
                  </div>
                  <svg id="coastline-overlay" class="coastline-overlay" hidden preserveAspectRatio="none" aria-hidden="true"></svg>
                </div>
              </div>
            </div>
            <div class="playback-bar">
              <div id="playback-controls" class="playback-controls" hidden>
                <div class="date-nav">
                  <button type="button" id="btn-date-prev" aria-label="Previous day">◀</button>
                  <input id="date-picker" type="date" aria-label="Date (UTC)" />
                  <button type="button" id="btn-date-next" aria-label="Next day">▶</button>
                </div>
                <div class="time-scrubber">
                  <button type="button" id="btn-play-pause" aria-label="Play">▶</button>
                  <input id="time-slider" type="range" min="0" max="0" value="0" />
                  <span id="time-label" class="time-label"></span>
                </div>
              </div>
              <p id="hover-bar" class="hover-bar">&nbsp;</p>
              <button type="button" id="btn-layout" class="status-bar-btn" aria-label="Full tab view">⤢</button>
            </div>
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

async function loadViewer(params: ViewerUrlParams, options?: LoadViewerOptions): Promise<void> {
  if (!params.storeUrl.trim()) {
    state.auth = undefined;
    showIdleState();
    return;
  }

  hideIdleState();
  stopAnimation();
  state.auth = params.auth;
  updateDatasetLabel(params.storeUrl, params.auth);
  renderStatus(el<HTMLParagraphElement>("#status"), "Opening store…");
  resetChunkLoadConfirmations();
  state.spatialRegion = null;
  try {
    state.dataset = options?.dataset ?? (await connectStore(params.storeUrl, params.auth));
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
      let variableReady = false;
      try {
        await selectVariable(defaultVariable);
        variableReady = true;
      } catch (error) {
        state.variable = null;
        reportError(error);
      }
      applyViewerParams(params);
      if (state.variable && state.spatialRegion) {
        retainSpatialRegionForVariable(state.variable);
      }
      if (variableReady && state.variable) {
        await renderCurrentFrame();
      }
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
    const transform = state.displayTransform ?? {
      planeWidth: state.currentPlane.shape[state.currentPlane.axes.x],
      planeHeight: state.currentPlane.shape[state.currentPlane.axes.y],
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      regionX0: 0,
      regionY0: 0,
      regionWidth: state.currentPlane.shape[state.currentPlane.axes.x],
      regionHeight: state.currentPlane.shape[state.currentPlane.axes.y],
    };
    const planePixel = canvasToPlanePixel(
      pixel.x,
      pixel.y,
      transform,
      effectiveSpatialCoords()?.flipY ?? false,
    );
    const bandAxis = axisByRole(state.variable, "band");
    hoverBar.textContent = formatHoverLine(
      state.currentPlane,
      planePixel.x,
      planePixel.y,
      effectiveSpatialCoords(),
      bandAxis?.coordinate?.labels,
      variableDataUnit(),
    );
  });

  canvas.addEventListener("mouseleave", () => {
    updateHoverBarIdle();
  });
}

function wireEvents(): void {
  el<HTMLButtonElement>("#btn-dataset-change").addEventListener("click", () => {
    connectDialogControls?.open();
  });

  el<HTMLSelectElement>("#variable-select").addEventListener("change", (event) => {
    void (async () => {
      try {
        const prevTimeAxis = state.variable ? axisByRole(state.variable, "time") : undefined;
        const preferredTimeIndex =
          prevTimeAxis !== undefined ? state.selection[prevTimeAxis.name] : undefined;
        await selectVariable((event.target as HTMLSelectElement).value, {
          preferredTimeIndex,
        });
        await renderCurrentFrame();
      } catch (error) {
        reportError(error);
      }
    })();
  });

  el<HTMLInputElement>("#date-picker").addEventListener("change", () => onDateChanged());
  el<HTMLInputElement>("#date-picker").addEventListener("click", () => openDatePicker());
  el<HTMLButtonElement>("#btn-date-prev").addEventListener("click", () => shiftDate(-1));
  el<HTMLButtonElement>("#btn-date-next").addEventListener("click", () => shiftDate(1));

  el<HTMLInputElement>("#time-slider").addEventListener("input", (event) => {
    if (suppressSliderEvent) return;
    stopAnimation();
    setTimeSliderPosition(Number((event.target as HTMLInputElement).value));
    void renderCurrentFrame();
  });

  el<HTMLButtonElement>("#btn-play-pause").addEventListener("click", () => togglePlayback());
  el<HTMLButtonElement>("#btn-zoom").addEventListener("click", () => toggleFillView());
  el<HTMLButtonElement>("#btn-layout").addEventListener("click", () => toggleFullTabMode());

  el<HTMLSelectElement>("#scale-mode").addEventListener("change", (event) => {
    const scaleMode = (event.target as HTMLSelectElement).value as ScaleMode;
    state.scaleMode = scaleMode;
    if (scaleMode === "none") {
      state.manualScale.needsSeed = false;
      seedManualScaleFromCurrentFrame();
      pushViewerUrl();
    } else {
      state.manualScale.locked = false;
      state.manualScale.needsSeed = false;
      state.manualScale.ranges = [];
      if (state.variable) buildScaleControls(state.variable);
      pushViewerUrl();
    }
    void renderCurrentFrame();
  });

  el<HTMLInputElement>("#show-coastlines").addEventListener("change", (event) => {
    state.showCoastlines = (event.target as HTMLInputElement).checked;
    syncCoastlineOverlay(el<HTMLCanvasElement>("#canvas"));
  });

  window.addEventListener("resize", () => {
    if (state.currentPlane && state.variable) {
      void renderCurrentFrame({ quiet: true });
      return;
    }
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
  });
}

async function main(): Promise<void> {
  subscribeChunkProgress(() => refreshLoadingStatus());
  mountLayout();
  initPanels();
  initResponsivePanelMode();
  if (window.matchMedia("(max-width: 960px)").matches) {
    state.fullTabMode = true;
  }
  updateLayoutButton();
  wireChunkConfirmDialog();
  connectDialogControls = wireConnectDialog({
    getStoreUrl: () => state.dataset?.schema.url ?? readViewerParams().storeUrl,
    getAuth: () => state.auth,
    onConnect: async (storeUrl, auth, dataset) => {
      const resolved = stripAuthFromUrl(resolveStoreUrl(storeUrl));
      const currentStore = state.dataset?.schema.url;
      const params =
        currentStore && sameStoreUrl(currentStore, resolved)
          ? { ...readViewerParams(), storeUrl: resolved, auth }
          : freshViewerParamsForStore(resolved, auth);
      await loadViewer(params, { dataset });
    },
  });
  wireEvents();
  wirePanels(() => {
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
    refreshHistogram();
  });
  wireCanvasHover();
  const canvas = el<HTMLCanvasElement>("#canvas");
  const canvasWrap = el<HTMLDivElement>("#canvas-wrap");
  const canvasStack = document.querySelector<HTMLDivElement>(".canvas-stack");
  if (!canvasStack) throw new Error("Missing .canvas-stack");
  viewPan = wireViewPan(
    canvasWrap,
    canvasStack,
    canvas,
    () => !state.fillView,
    () => {
      const plane = state.currentPlane;
      if (!plane) return { width: 0, height: 0 };
      return {
        width: plane.shape[plane.axes.x],
        height: plane.shape[plane.axes.y],
      };
    },
    () => ({
      width: canvasWrap.clientWidth,
      height: canvasWrap.clientHeight,
    }),
    () => state.viewOrigin,
    commitViewOrigin,
  );
  viewPan.sync();
  const params = readViewerParams();
  if (params.storeUrl) {
    await loadViewer(params);
  } else {
    showIdleState();
    connectDialogControls?.open();
  }
}

void main();
