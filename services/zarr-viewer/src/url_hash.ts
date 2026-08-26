import LZString from "lz-string";
import { resolveStoreAuth, serializeAuthParam } from "./auth.js";
import { isColormapName } from "./colormap.js";
import type { ScaleMode } from "./scaling.js";
import { parseScaleParam } from "./scale_url.js";
import type { ViewerUrlParams } from "./url_state.js";
import type { SpatialRegionPick } from "./chunk_plan.js";

export interface ViewerStateJsonV1 {
  v: 1;
  u?: string;
  auth?: string;
  var?: string;
  dt?: string;
  rgb?: [number, number, number];
  cmap?: string;
  as?: 0 | 1 | 2;
  scale?: string;
  zoom?: "fill";
  dims?: Record<string, number>;
  /** Spatial chunk region [y0, y1, x0, x1] inclusive */
  region?: [number, number, number, number];
  ui?: "full";
}

export function parseScaleModeFromJson(as: 0 | 1 | 2 | undefined): ScaleMode | undefined {
  if (as === 0) return "none";
  if (as === 1) return "minmax";
  if (as === 2) return "percentile";
  return undefined;
}

export function viewerParamsToJson(params: ViewerUrlParams): ViewerStateJsonV1 {
  const json: ViewerStateJsonV1 = { v: 1 };

  if (params.storeUrl.trim()) {
    json.u = params.storeUrl;
  }
  if (params.auth) {
    const serialized = serializeAuthParam(params.auth);
    if (serialized) json.auth = serialized;
  }
  if (params.variable) json.var = params.variable;
  if (params.datetime) json.dt = params.datetime;
  if (params.rgb) json.rgb = params.rgb;
  if (params.colormap) json.cmap = params.colormap;
  if (params.scaleMode === "none") json.as = 0;
  else if (params.scaleMode === "minmax") json.as = 1;
  else if (params.scaleMode === "percentile") json.as = 2;
  if (params.manualScale && params.manualScale.length > 0) {
    json.scale = params.manualScale.map((r) => `${r.min}:${r.max}`).join(",");
  }
  if (params.fillView) json.zoom = "fill";
  if (params.dims && Object.keys(params.dims).length > 0) {
    json.dims = params.dims;
  }
  if (params.spatialRegion) {
    const { y0, y1, x0, x1 } = params.spatialRegion;
    json.region = [y0, y1, x0, x1];
  }
  if (params.fullTab) json.ui = "full";

  return json;
}

export function jsonToViewerParams(
  json: ViewerStateJsonV1,
  resolveStoreUrl: (raw: string) => string,
  defaultStoreUrl?: string,
): ViewerUrlParams {
  const rawUrl = json.u;
  const storeUrl =
    rawUrl !== undefined
      ? rawUrl.trim()
        ? resolveStoreUrl(rawUrl)
        : ""
      : defaultStoreUrl?.trim()
        ? resolveStoreUrl(defaultStoreUrl)
        : "";

  const auth = storeUrl ? resolveStoreAuth(storeUrl, json.auth ?? null) : undefined;

  let spatialRegion: SpatialRegionPick | undefined;
  if (
    json.region &&
    json.region.length === 4 &&
    json.region.every((value) => Number.isFinite(value) && value >= 0)
  ) {
    spatialRegion = {
      y0: json.region[0],
      y1: json.region[1],
      x0: json.region[2],
      x1: json.region[3],
    };
  }

  return {
    storeUrl,
    auth,
    variable: json.var,
    datetime: json.dt,
    rgb: json.rgb,
    colormap: json.cmap && isColormapName(json.cmap) ? json.cmap : undefined,
    scaleMode: parseScaleModeFromJson(json.as),
    manualScale: json.scale ? parseScaleParam(json.scale) : undefined,
    fillView: json.zoom === "fill" ? true : undefined,
    dims: json.dims ?? {},
    spatialRegion,
    fullTab: json.ui === "full" ? true : undefined,
  };
}

export function encodeViewerHash(json: ViewerStateJsonV1): string {
  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(json));
  if (!compressed) throw new Error("Failed to compress viewer state");
  return compressed;
}

export function decodeViewerHash(
  hash: string,
  resolveStoreUrl: (raw: string) => string,
  defaultStoreUrl?: string,
): ViewerUrlParams | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;

  try {
    const jsonText = LZString.decompressFromEncodedURIComponent(trimmed);
    if (!jsonText) return null;

    const parsed: unknown = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object") return null;

    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return null;

    return jsonToViewerParams(record as unknown as ViewerStateJsonV1, resolveStoreUrl, defaultStoreUrl);
  } catch {
    return null;
  }
}
