import type { StoreAuth } from "./auth.js";
import {
  parseAuthFromUrl,
  parseBearerAuthParam,
  resolveStoreAuth,
  serializeAuthParam,
  serializeBearerAuthParam,
  stripAuthFromUrl,
} from "./auth.js";
import { DEFAULT_COLORMAP, isColormapName } from "./colormap.js";
import type { ImageVariable } from "./dimensions.js";
import { axisByRole } from "./dimensions.js";
import { defaultRgbBands, rgbBandsEqual, type ScaleRange } from "./scaling.js";
import { parseScaleParam, serializeScaleParam } from "./scale_url.js";
import { formatDate, formatTime } from "./time.js";
import {
  decodeViewerHash,
  encodeViewerHash,
  type ViewerStateJsonV1,
  viewerParamsToJson,
} from "./url_hash.js";

import type { SpatialRegionPick } from "./chunk_plan.js";

export type { StoreAuth };

export interface ViewerUrlParams {
  storeUrl: string;
  auth?: StoreAuth;
  variable?: string;
  datetime?: string;
  rgb?: [number, number, number];
  colormap?: string;
  autoscale?: boolean;
  manualScale?: ScaleRange[];
  fillView?: boolean;
  fullTab?: boolean;
  dims: Record<string, number>;
  spatialRegion?: SpatialRegionPick;
}

const RESERVED_VIEWER_PARAMS = new Set([
  "url",
  "variable",
  "datetime",
  "rgb",
  "cmap",
  "autoscale",
  "scale",
  "zoom",
  "auth",
]);

function normalizeTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Resolve path-only or relative store URLs against the current page origin. */
export function resolveStoreUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return normalizeTrailingSlash(trimmed);
  }

  const absolute = new URL(trimmed, window.location.origin).href;
  return normalizeTrailingSlash(absolute);
}

/** Example same-origin store path derived from the viewer URL (/stac/viewer/ → /stac/data/...). */
export function defaultStorePathExample(dataset = "fisheye/sophia.zarr"): string {
  const match = window.location.pathname.match(/^(.*)\/viewer\/?$/);
  const prefix = match?.[1] ?? "";
  return `${prefix}/data/${dataset}/`;
}

/** Keep same-origin stores as path-only URLs for sharing in the address bar. */
export function toShareableStoreUrl(resolved: string): string {
  const trimmed = resolved.trim();
  if (!trimmed) return "";

  const stripped = stripAuthFromUrl(trimmed);
  try {
    const url = new URL(stripped);
    if (url.origin === window.location.origin) {
      const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      return path;
    }
  } catch {
    return normalizeTrailingSlash(stripped);
  }

  return normalizeTrailingSlash(stripped);
}

/** Store URL for the url-input field (never shows credentials). */
export function toDisplayStoreUrl(resolved: string, _auth?: StoreAuth): string {
  return toShareableStoreUrl(stripAuthFromUrl(resolved));
}

function hasLegacyViewerParams(params: URLSearchParams): boolean {
  for (const key of RESERVED_VIEWER_PARAMS) {
    if (params.has(key)) return true;
  }
  return false;
}

export function parseLegacySearchParams(
  search: string,
  defaultStoreUrl?: string,
): { params: ViewerUrlParams; hadLegacy: boolean } {
  const params = new URLSearchParams(search);
  if (!hasLegacyViewerParams(params)) {
    return {
      params: {
        storeUrl: defaultStoreUrl?.trim() ? resolveStoreUrl(defaultStoreUrl) : "",
        dims: {},
      },
      hadLegacy: false,
    };
  }

  const rgbParam = params.get("rgb");
  let rgb: [number, number, number] | undefined;
  if (rgbParam) {
    const parts = rgbParam.split(",").map((part) => Number(part.trim()));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      rgb = [parts[0], parts[1], parts[2]];
    }
  }

  const dims: Record<string, number> = {};
  for (const [key, value] of params.entries()) {
    if (RESERVED_VIEWER_PARAMS.has(key)) continue;
    const index = Number(value);
    if (Number.isFinite(index)) dims[key] = index;
  }

  const autoscaleParam = params.get("autoscale");
  const scaleParam = params.get("scale");
  const cmapParam = params.get("cmap");
  const zoomParam = params.get("zoom");
  const authParam = params.get("auth");
  const rawUrl = params.get("url");
  const storeUrl =
    rawUrl !== null
      ? rawUrl.trim()
        ? resolveStoreUrl(rawUrl)
        : ""
      : defaultStoreUrl?.trim()
        ? resolveStoreUrl(defaultStoreUrl)
        : "";

  const auth = storeUrl ? resolveStoreAuth(storeUrl, authParam) : undefined;

  return {
    hadLegacy: true,
    params: {
      storeUrl,
      auth,
      variable: params.get("variable") ?? undefined,
      datetime: params.get("datetime") ?? undefined,
      rgb,
      colormap: cmapParam && isColormapName(cmapParam) ? cmapParam : undefined,
      autoscale: autoscaleParam === "0" ? false : autoscaleParam === "1" ? true : undefined,
      manualScale: scaleParam ? parseScaleParam(scaleParam) : undefined,
      fillView: zoomParam === "fill" ? true : zoomParam === "1" ? true : undefined,
      dims,
    },
  };
}

function writeViewerHashFromParams(params: ViewerUrlParams): void {
  const shareable: ViewerUrlParams = {
    ...params,
    storeUrl: params.storeUrl ? toShareableStoreUrl(params.storeUrl) : "",
  };
  const json = viewerParamsToJson(shareable);
  replaceLocationHash(json);
}

function replaceLocationHash(json: ViewerStateJsonV1): void {
  const compressed = encodeViewerHash(json);
  window.history.replaceState({}, "", `${window.location.pathname}#${compressed}`);
}

export function readViewerParams(defaultStoreUrl?: string): ViewerUrlParams {
  const legacy = parseLegacySearchParams(window.location.search, defaultStoreUrl);
  if (legacy.hadLegacy) {
    writeViewerHashFromParams(legacy.params);
    return legacy.params;
  }

  const fromHash = decodeViewerHash(
    window.location.hash,
    resolveStoreUrl,
    defaultStoreUrl,
  );
  if (fromHash) return fromHash;

  return {
    storeUrl: defaultStoreUrl?.trim() ? resolveStoreUrl(defaultStoreUrl) : "",
    dims: {},
  };
}

/** True when two store URLs resolve to the same absolute location. */
export function sameStoreUrl(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return resolveStoreUrl(a) === resolveStoreUrl(b);
}

/** Params for loading a different store — omits hash-specific viewer state. */
export function freshViewerParamsForStore(
  storeUrl: string,
  auth?: StoreAuth,
): ViewerUrlParams {
  return {
    storeUrl: resolveStoreUrl(storeUrl),
    auth,
    dims: {},
  };
}

export function writeViewerParams(input: {
  storeUrl: string;
  auth?: StoreAuth;
  variable: ImageVariable;
  timeDates: Date[];
  selection: Record<string, number>;
  rgbBands: [number, number, number];
  colormap: string;
  autoscale: boolean;
  manualScale: ScaleRange[];
  fillView: boolean;
  fullTab: boolean;
  spatialRegion?: SpatialRegionPick | null;
}): void {
  const json: ViewerStateJsonV1 = { v: 1 };
  json.u = toShareableStoreUrl(input.storeUrl);
  json.var = input.variable.path;

  if (input.auth) {
    const serialized = serializeAuthParam(input.auth);
    if (serialized) json.auth = serialized;
  }

  const timeAxis = axisByRole(input.variable, "time");
  if (timeAxis) {
    const timeIndex = input.selection[timeAxis.name];
    const date = input.timeDates[timeIndex];
    if (date) {
      json.dt = date.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
  }

  const bandAxis = axisByRole(input.variable, "band");
  if (bandAxis && bandAxis.size >= 3) {
    const defaults = defaultRgbBands(bandAxis.coordinate?.labels, bandAxis.size);
    if (!rgbBandsEqual(input.rgbBands, defaults)) {
      json.rgb = [...input.rgbBands];
    }
  } else if (input.colormap !== DEFAULT_COLORMAP) {
    json.cmap = input.colormap;
  }

  if (!input.autoscale) {
    json.as = 0;
    if (input.manualScale.length > 0) {
      json.scale = serializeScaleParam(input.manualScale);
    }
  }

  if (input.fillView) {
    json.zoom = "fill";
  }

  if (input.fullTab) {
    json.ui = "full";
  }

  const dims: Record<string, number> = {};
  for (const axis of input.variable.axes) {
    if (["time", "x", "y", "band"].includes(axis.role)) continue;
    const value = input.selection[axis.name];
    if (value !== undefined && value !== 0) {
      dims[axis.name] = value;
    }
  }
  if (Object.keys(dims).length > 0) {
    json.dims = dims;
  }

  if (input.spatialRegion) {
    const { y0, y1, x0, x1 } = input.spatialRegion;
    json.region = [y0, y1, x0, x1];
  }

  replaceLocationHash(json);
}

export function resolveTimeIndexFromDatetime(
  dates: Date[],
  datetime: string,
): number | undefined {
  const target = Date.parse(datetime);
  if (!Number.isFinite(target)) return undefined;
  let bestIndex = 0;
  let bestDelta = Infinity;
  for (let index = 0; index < dates.length; index++) {
    const delta = Math.abs(dates[index].getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function applyDatetimeToControls(
  dates: Date[],
  timeIndex: number,
  dateInput: HTMLInputElement,
): void {
  const date = dates[timeIndex];
  if (!date) return;
  dateInput.value = formatDate(date);
}

export function formatDatetimeLabel(date: Date): string {
  return `${formatDate(date)} ${formatTime(date)} UTC`;
}

// Re-export auth helpers used by tests
export { parseAuthFromUrl, parseBearerAuthParam, serializeBearerAuthParam };
