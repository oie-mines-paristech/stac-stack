import type { StoreAuth } from "./auth.js";
import {
  parseAuthFromUrl,
  parseBearerAuthParam,
  resolveStoreAuth,
  serializeBearerAuthParam,
} from "./auth.js";
import { DEFAULT_COLORMAP, isColormapName } from "./colormap.js";
import type { ImageVariable } from "./dimensions.js";
import { axisByRole } from "./dimensions.js";
import { defaultRgbBands, rgbBandsEqual, type ScaleRange } from "./scaling.js";
import { parseScaleParam, serializeScaleParam } from "./scale_url.js";
import { formatDate, formatTime } from "./time.js";

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
  dims: Record<string, number>;
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

  try {
    const url = new URL(trimmed);
    if (url.username || url.password) {
      const href = url.href;
      return href.endsWith("/") ? href : `${href}/`;
    }
    if (url.origin === window.location.origin) {
      const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      return path;
    }
  } catch {
    return normalizeTrailingSlash(trimmed);
  }

  return normalizeTrailingSlash(trimmed);
}

/** Store URL for the url-input field (hides Bearer token, keeps Basic userinfo). */
export function toDisplayStoreUrl(resolved: string, auth?: StoreAuth): string {
  if (auth?.kind === "bearer") {
    try {
      const url = new URL(resolved);
      url.username = "";
      url.password = "";
      return toShareableStoreUrl(url.href);
    } catch {
      return toShareableStoreUrl(resolved);
    }
  }
  return toShareableStoreUrl(resolved);
}

export function readViewerParams(defaultStoreUrl?: string): ViewerUrlParams {
  const params = new URLSearchParams(window.location.search);
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
}): void {
  const params = new URLSearchParams();
  params.set("url", toShareableStoreUrl(input.storeUrl));
  params.set("variable", input.variable.path);

  if (input.auth?.kind === "bearer") {
    const serialized = serializeBearerAuthParam(input.auth);
    if (serialized) params.set("auth", serialized);
  }

  const timeAxis = axisByRole(input.variable, "time");
  if (timeAxis) {
    const timeIndex = input.selection[timeAxis.name];
    const date = input.timeDates[timeIndex];
    if (date) {
      params.set("datetime", date.toISOString().replace(/\.\d{3}Z$/, "Z"));
    }
  }

  const bandAxis = axisByRole(input.variable, "band");
  if (bandAxis && bandAxis.size >= 3) {
    const defaults = defaultRgbBands(bandAxis.coordinate?.labels, bandAxis.size);
    if (!rgbBandsEqual(input.rgbBands, defaults)) {
      params.set("rgb", input.rgbBands.join(","));
    }
  } else if (input.colormap !== DEFAULT_COLORMAP) {
    params.set("cmap", input.colormap);
  }

  if (!input.autoscale) {
    params.set("autoscale", "0");
    if (input.manualScale.length > 0) {
      params.set("scale", serializeScaleParam(input.manualScale));
    }
  }

  if (input.fillView) {
    params.set("zoom", "fill");
  }

  for (const axis of input.variable.axes) {
    if (["time", "x", "y", "band"].includes(axis.role)) continue;
    const value = input.selection[axis.name];
    if (value !== undefined && value !== 0) {
      params.set(axis.name, String(value));
    }
  }

  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", next);
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
