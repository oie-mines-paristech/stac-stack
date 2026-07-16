import "./style.css";
import {
  axisByRole,
  otherAxes,
  type ImageVariable,
} from "./dimensions.js";
import { canvasPixelCoords, formatHoverLine, type SpatialCoords } from "./hover.js";
import {
  cancelPrefetch,
  loadPlaneWithCache,
  LruPlaneCache,
  prefetchDayPlanes,
  type FrameTimings,
} from "./plane_cache.js";
import {
  renderImageToCanvas,
  type ImagePlane,
  type RenderOptions,
} from "./render.js";
import { defaultRgbBands } from "./scaling.js";
import {
  openDataset,
  openVariableArray,
  readCoordinateValues,
  type OpenDatasetResult,
} from "./store.js";
import {
  dateRangeFromDates,
  defaultDayFromDates,
  filterTimeIndicesByDay,
  formatTime,
  timeValuesToDates,
} from "./time.js";
import { renderMetadataPanel, renderStatus, renderTimings } from "./ui/metadata.js";
import {
  applyDatetimeToControls,
  readViewerParams,
  resolveTimeIndexFromDatetime,
  writeViewerParams,
  type ViewerUrlParams,
} from "./url_state.js";

const DEFAULT_URL =
  "https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/";

interface AppState {
  dataset: OpenDatasetResult | null;
  variable: ImageVariable | null;
  timeDates: Date[];
  timeIndices: number[];
  selection: Record<string, number>;
  rgbBands: [number, number, number];
  autoscale: boolean;
  spatialCoords: SpatialCoords | null;
  currentPlane: ImagePlane | null;
  isPlaying: boolean;
  renderGeneration: number;
  fillView: boolean;
}

const state: AppState = {
  dataset: null,
  variable: null,
  timeDates: [],
  timeIndices: [],
  selection: {},
  rgbBands: [0, 1, 2],
  autoscale: true,
  spatialCoords: null,
  currentPlane: null,
  isPlaying: false,
  renderGeneration: 0,
  fillView: false,
};

const PLAYBACK_INTERVAL_MS = 500;

let suppressSliderEvent = false;
const planeCache = new LruPlaneCache(128);

function formatTimings(timings: FrameTimings): string {
  if (timings.cacheHit) {
    return `cache hit · render ${timings.renderMs.toFixed(0)} ms`;
  }
  return `fetch ${timings.fetchMs.toFixed(0)} ms · render ${timings.renderMs.toFixed(0)} ms`;
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

function clearFrameCache(): void {
  planeCache.clear();
  cancelPrefetch();
}

function schedulePrefetch(): void {
  if (!state.dataset || !state.variable) return;
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
      isCurrentGeneration: () => generation === state.renderGeneration,
    }),
  );
}

function el<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node as T;
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

function displayMode(variable: ImageVariable): "rgb" | "gray" {
  const bandAxis = axisByRole(variable, "band");
  return bandAxis && bandAxis.size >= 3 ? "rgb" : "gray";
}

function renderOptions(variable: ImageVariable): RenderOptions {
  return {
    mode: displayMode(variable),
    rgbBands: state.rgbBands,
    autoscale: state.autoscale,
    attributes: variable.attributes,
  };
}

function pushViewerUrl(): void {
  if (!state.dataset || !state.variable) return;
  writeViewerParams({
    storeUrl: state.dataset.schema.url,
    variable: state.variable,
    timeDates: state.timeDates,
    selection: state.selection,
    rgbBands: state.rgbBands,
    autoscale: state.autoscale,
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
  state.spatialCoords = {
    xName: xAxis?.name ?? "x",
    yName: yAxis?.name ?? "y",
    xValues,
    yValues,
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
    option.textContent = `${variable.path} [${variable.dimensionNames.join(", ")}]`;
    select.appendChild(option);
  }
}

function buildRgbBandControls(variable: ImageVariable): void {
  const fieldset = el<HTMLFieldSetElement>("#rgb-controls");
  const bandAxis = axisByRole(variable, "band");
  const mode = displayMode(variable);
  fieldset.hidden = mode !== "rgb" || !bandAxis;

  if (fieldset.hidden || !bandAxis) return;

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
    const mid = state.timeIndices[Math.floor(state.timeIndices.length / 2)];
    state.selection[timeAxis.name] = mid;
    syncTimeSlider();
  }
}

function applyViewerParams(params: ViewerUrlParams): void {
  if (params.autoscale !== undefined) {
    state.autoscale = params.autoscale;
    el<HTMLInputElement>("#autoscale").checked = params.autoscale;
  }

  if (params.fillView !== undefined) {
    state.fillView = params.fillView;
    updateZoomButton();
  }

  if (params.rgb) {
    state.rgbBands = params.rgb;
    syncRgbSelects();
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
  state.variable = variable;
  state.selection = defaultSelection(variable);
  buildOtherDimControls(variable);
  buildRgbBandControls(variable);
  await Promise.all([
    loadTimeCoordinate(state.dataset, variable),
    loadSpatialCoords(state.dataset, variable),
  ]);
  renderMetadataPanel(el<HTMLElement>("#metadata"), state.dataset.schema, variable);
  el<HTMLSelectElement>("#variable-select").value = path;
}

async function renderCurrentFrame(options?: { quiet?: boolean }): Promise<FrameTimings | null> {
  if (!state.dataset || !state.variable) return null;
  const generation = ++state.renderGeneration;
  const status = el<HTMLParagraphElement>("#status");
  const timingsEl = el<HTMLParagraphElement>("#timings");
  if (!options?.quiet) renderStatus(status, "Loading…");

  try {
    const arr = await openVariableArray(state.dataset.root, state.variable);
    const options_ = renderOptions(state.variable);
    const { plane, timings } = await loadPlaneWithCache(
      planeCache,
      arr,
      state.variable,
      state.selection,
      options_.mode,
    );
    if (generation !== state.renderGeneration) return null;

    state.currentPlane = plane;
    const canvas = el<HTMLCanvasElement>("#canvas");
    const renderStart = performance.now();
    renderImageToCanvas(canvas, plane, options_);
    timings.renderMs = performance.now() - renderStart;
    fitCanvasDisplay(canvas);
    syncTimeSlider();
    renderStatus(status, "");
    renderTimings(timingsEl, formatTimings(timings));
    pushViewerUrl();
    schedulePrefetch();
    return timings;
  } catch (error) {
    if (generation !== state.renderGeneration) return null;
    renderTimings(timingsEl, "");
    renderStatus(
      status,
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
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
        <label class="control url-control">
          Store URL
          <input id="url-input" type="url" value="${DEFAULT_URL}" />
        </label>
      </header>
      <div class="body">
        <aside class="sidebar">
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
          <fieldset id="rgb-controls" hidden>
            <legend>RGB bands</legend>
            <div class="rgb-row">
              <label>R <select id="band-r"></select></label>
              <label>G <select id="band-g"></select></label>
              <label>B <select id="band-b"></select></label>
            </div>
          </fieldset>
          <label class="control checkbox">
            <input id="autoscale" type="checkbox" checked />
            Autoscale (P5–P95)
          </label>
          <div id="other-dims"></div>
          <p id="timings" class="muted"></p>
          <p id="status" class="muted"></p>
        </aside>
        <main class="stage">
          <div class="stage-inner">
            <div id="canvas-wrap" class="canvas-wrap">
              <button type="button" id="btn-zoom" class="canvas-tool" aria-label="Zoom image to fill view">⛶</button>
              <canvas id="canvas"></canvas>
            </div>
            <p id="hover-bar" class="hover-bar">&nbsp;</p>
          </div>
        </main>
        <aside id="metadata" class="metadata"></aside>
      </div>
    </div>
  `;
}

async function loadViewer(params: ViewerUrlParams): Promise<void> {
  stopAnimation();
  renderStatus(el<HTMLParagraphElement>("#status"), "Opening store…");
  state.dataset = await openDataset(params.storeUrl);
  buildVariableSelect(state.dataset.schema);
  el<HTMLInputElement>("#url-input").value = params.storeUrl;

  const defaultVariable =
    params.variable ??
    state.dataset.schema.variables.find((item) => item.path === "radiance")?.path ??
    state.dataset.schema.variables[0]?.path;

  if (defaultVariable) {
    await selectVariable(defaultVariable);
    applyViewerParams(params);
    await renderCurrentFrame();
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
      state.spatialCoords,
      bandAxis?.coordinate?.labels,
    );
  });

  canvas.addEventListener("mouseleave", () => {
    hoverBar.innerHTML = "&nbsp;";
  });
}

function wireEvents(): void {
  el<HTMLInputElement>("#url-input").addEventListener("change", (event) => {
    const url = (event.target as HTMLInputElement).value.trim();
    void loadViewer({ ...readViewerParams(DEFAULT_URL), storeUrl: url });
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
      state.selection[timeAxis.name] =
        state.timeIndices[Math.floor(state.timeIndices.length / 2)];
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
    state.autoscale = (event.target as HTMLInputElement).checked;
    void renderCurrentFrame();
  });

  window.addEventListener("resize", () => {
    fitCanvasDisplay(el<HTMLCanvasElement>("#canvas"));
  });
}

async function main(): Promise<void> {
  mountLayout();
  wireEvents();
  wireCanvasHover();
  await loadViewer(readViewerParams(DEFAULT_URL));
}

void main();
