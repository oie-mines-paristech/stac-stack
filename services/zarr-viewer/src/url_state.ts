import type { ImageVariable } from "./dimensions.js";
import { axisByRole } from "./dimensions.js";
import { defaultRgbBands, rgbBandsEqual } from "./scaling.js";
import { formatDate, formatTime } from "./time.js";

export interface ViewerUrlParams {
  storeUrl: string;
  variable?: string;
  datetime?: string;
  rgb?: [number, number, number];
  autoscale?: boolean;
  fillView?: boolean;
  dims: Record<string, number>;
}

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

/** Keep same-origin stores as path-only URLs for sharing in the address bar. */
export function toShareableStoreUrl(resolved: string): string {
  const trimmed = resolved.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.origin === window.location.origin) {
      const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      return path;
    }
  } catch {
    return normalizeTrailingSlash(trimmed);
  }

  return normalizeTrailingSlash(trimmed);
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
    if (key === "url" || key === "variable" || key === "datetime" || key === "rgb" || key === "autoscale" || key === "zoom") {
      continue;
    }
    const index = Number(value);
    if (Number.isFinite(index)) dims[key] = index;
  }

  const autoscaleParam = params.get("autoscale");
  const zoomParam = params.get("zoom");
  const rawUrl = params.get("url");
  const storeUrl =
    rawUrl !== null
      ? rawUrl.trim()
        ? resolveStoreUrl(rawUrl)
        : ""
      : defaultStoreUrl?.trim()
        ? resolveStoreUrl(defaultStoreUrl)
        : "";
  return {
    storeUrl,
    variable: params.get("variable") ?? undefined,
    datetime: params.get("datetime") ?? undefined,
    rgb,
    autoscale: autoscaleParam === "0" ? false : autoscaleParam === "1" ? true : undefined,
    fillView: zoomParam === "fill" ? true : zoomParam === "1" ? true : undefined,
    dims,
  };
}

export function writeViewerParams(input: {
  storeUrl: string;
  variable: ImageVariable;
  timeDates: Date[];
  selection: Record<string, number>;
  rgbBands: [number, number, number];
  autoscale: boolean;
  fillView: boolean;
}): void {
  const params = new URLSearchParams();
  params.set("url", toShareableStoreUrl(input.storeUrl));
  params.set("variable", input.variable.path);

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
  }

  if (!input.autoscale) {
    params.set("autoscale", "0");
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
