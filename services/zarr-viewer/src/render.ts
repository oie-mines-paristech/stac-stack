import * as zarr from "zarrita";
import { loadFullPlane, type SpatialRegionSelection } from "./array_load.js";
import { spatialChunkGrid, type SpatialRegionPick } from "./chunk_plan.js";
import { chunkValue, computeStrides, resolvePlaneAxes } from "./chunk_utils.js";
import { DEFAULT_COLORMAP, getColormapLut } from "./colormap.js";
import type { ImageVariable } from "./dimensions.js";
import { ensurePlaneBandStats, type BandValueStats, type PlaneForStats } from "./plane_stats.js";
import { putRgbaOnCanvas2d, renderRgbRegionToRgba, renderScalarRegionToRgba } from "./render_core.js";
import {
  cfScaleBounds,
  integerDtypeDisplayRange,
  scaleRangeFromBandStats,
  type ScaleMode,
  type ScaleRange,
} from "./scaling.js";
import {
  canvasToPlanePixel,
  computeViewLayout,
  type DisplayTransform,
  type DisplaySize,
  type ViewLayout,
  type ViewOrigin,
} from "./view_transform.js";

export type { DisplaySize, DisplayTransform, ViewLayout, ViewOrigin };

export interface ImagePlane extends PlaneForStats {}

export function countFiniteSamples(plane: ImagePlane): number {
  let count = 0;
  for (const value of plane.data) {
    if (Number.isFinite(value)) count++;
  }
  return count;
}

/** False when a float plane is all-zero (common empty-chunk sentinel) or entirely non-finite. */
export function planeHasDisplayableData(plane: ImagePlane, variableDtype: string): boolean {
  if (countFiniteSamples(plane) === 0) return false;
  const isFloat = variableDtype.toLowerCase().includes("float");
  if (!isFloat) return true;
  for (const value of plane.data) {
    if (Number.isFinite(value) && value !== 0) return true;
  }
  return false;
}

export interface RenderOptions {
  mode: "rgb" | "scalar";
  rgbBands: [number, number, number];
  scaleMode: ScaleMode;
  attributes: Record<string, unknown>;
  flipY?: boolean;
  colormap?: string;
  manualRanges?: ScaleRange[];
}

export interface RenderResult {
  scaleMin: number;
  scaleMax: number;
  displayTransform: DisplayTransform;
}

export function selectionFromState(
  variable: ImageVariable,
  values: Record<string, number>,
): number[] {
  return variable.axes.map((axis) => values[axis.name] ?? 0);
}

export async function loadImagePlane(
  arr: zarr.Array<zarr.DataType>,
  variable: ImageVariable,
  indices: number[],
  mode: "rgb" | "scalar" = "scalar",
  spatialRegion?: SpatialRegionPick,
): Promise<ImagePlane> {
  let regionSelection: SpatialRegionSelection | undefined;
  if (spatialRegion) {
    const grid = spatialChunkGrid(variable);
    if (grid) {
      regionSelection = { ...spatialRegion, grid };
    }
  }
  const loaded = await loadFullPlane(arr, variable, indices, mode, regionSelection);
  const axes = resolvePlaneAxes(variable, loaded.shape, mode === "rgb");
  return { data: loaded.data, shape: loaded.shape, axes };
}

export { ensurePlaneBandStats };

/** True when channel ranges need a full-plane stats pass before render. */
export function channelRangeNeedsBandStats(options: RenderOptions, dtype: string): boolean {
  if (options.scaleMode !== "none") return true;
  const { min: cfMin, max: cfMax } = cfScaleBounds(options.attributes);
  if (Number.isFinite(cfMin) && Number.isFinite(cfMax) && cfMax! > cfMin!) return false;
  if (integerDtypeDisplayRange(dtype)) return false;
  return !options.manualRanges?.some(
    (range) =>
      Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min,
  );
}

function resolveNoneChannelRange(
  manual: ScaleRange | undefined,
  cfMin: unknown,
  cfMax: unknown,
  dtype: string,
  stats: BandValueStats,
): [number, number] {
  if (manual && Number.isFinite(manual.min) && Number.isFinite(manual.max) && manual.max > manual.min) {
    return [manual.min, manual.max];
  }
  const min = Number(cfMin);
  const max = Number(cfMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    return [min, max];
  }
  const full = integerDtypeDisplayRange(dtype);
  if (full) return full;
  return scaleRangeFromBandStats(stats, "minmax", undefined, cfMin, cfMax);
}

/** Resolve per-channel [min,max] tuples; skips stats when None + integer dtype. */
export function resolveChannelRangeTuples(
  plane: PlaneForStats,
  options: RenderOptions,
  dtype: string,
  bandStats?: BandValueStats[],
  statsLevel: "minmax" | "full" = "full",
): Array<[number, number]> {
  const { shape, axes } = plane;
  const bandCount = axes.band >= 0 ? shape[axes.band]! : 1;
  const { min: cfMin, max: cfMax } = cfScaleBounds(options.attributes);
  const stats =
    bandStats ??
    (channelRangeNeedsBandStats(options, dtype)
      ? ensurePlaneBandStats(plane, statsLevel)
      : undefined);
  const fallbackStats: BandValueStats = {
    min: 0,
    max: 1,
    counts: new Uint32Array(0),
    sampleCount: 0,
  };

  if (options.mode === "scalar" || bandCount === 1) {
    const entry = stats?.[0] ?? fallbackStats;
    if (options.scaleMode === "none") {
      return [resolveNoneChannelRange(options.manualRanges?.[0], cfMin, cfMax, dtype, entry)];
    }
    const resolved = stats ?? ensurePlaneBandStats(plane, statsLevel);
    return [
      scaleRangeFromBandStats(
        resolved[0]!,
        options.scaleMode,
        options.manualRanges?.[0],
        cfMin,
        cfMax,
      ),
    ];
  }

  return options.rgbBands.map((band, channel) => {
    const entry = stats?.[band] ?? stats?.[0] ?? fallbackStats;
    if (options.scaleMode === "none") {
      return resolveNoneChannelRange(
        options.manualRanges?.[channel],
        cfMin,
        cfMax,
        dtype,
        entry,
      );
    }
    const resolved = stats ?? ensurePlaneBandStats(plane, statsLevel);
    return scaleRangeFromBandStats(
      resolved[band] ?? resolved[0]!,
      options.scaleMode,
      options.manualRanges?.[channel],
      cfMin,
      cfMax,
    );
  });
}

export function autoscaleRangesFromPlane(
  plane: ImagePlane,
  flipY: boolean,
  attributes: Record<string, unknown>,
  scaleMode: ScaleMode = "percentile",
  dtype = "float64",
  mode: "rgb" | "scalar" = "scalar",
  rgbBands: [number, number, number] = [0, 1, 2],
): ScaleRange[] {
  return computeChannelScaleRanges(
    plane,
    {
      mode,
      rgbBands,
      scaleMode,
      attributes,
      flipY,
    },
    dtype,
    plane.bandStats,
  );
}

/** Scale ranges per display channel (scalar: 1 entry; RGB: one per rgb band). */
export function computeChannelScaleRanges(
  plane: ImagePlane,
  options: RenderOptions,
  dtype: string,
  bandStats?: BandValueStats[],
): ScaleRange[] {
  return resolveChannelRangeTuples(plane, options, dtype, bandStats).map(([min, max]) => ({
    min,
    max,
  }));
}

function resolveScalarRange(
  options: RenderOptions,
  dtype: string,
  bandStats: BandValueStats[] | undefined,
  plane: PlaneForStats,
): [number, number] {
  return resolveChannelRangeTuples(plane, options, dtype, bandStats)[0]!;
}

function resolveRgbRanges(
  options: RenderOptions,
  dtype: string,
  bandStats: BandValueStats[] | undefined,
  plane: PlaneForStats,
): Array<[number, number]> {
  return resolveChannelRangeTuples(plane, options, dtype, bandStats);
}

export interface RenderLayoutInput {
  viewportWidth: number;
  viewportHeight: number;
  fillView: boolean;
  viewOrigin?: ViewOrigin;
}

/** Synchronous Canvas 2D render (tests and benchmarks). */
export function renderImageToCanvas(
  canvas: HTMLCanvasElement,
  plane: ImagePlane,
  options: RenderOptions,
  layoutInput?: RenderLayoutInput,
  dtype = "float64",
): RenderResult {
  const { data, shape, axes } = plane;
  const planeHeight = shape[axes.y]!;
  const planeWidth = shape[axes.x]!;
  const fillView = layoutInput?.fillView ?? false;
  const viewportWidth = layoutInput?.viewportWidth ?? planeWidth;
  const viewportHeight = layoutInput?.viewportHeight ?? planeHeight;
  const viewOrigin = layoutInput?.viewOrigin ?? { x: 0, y: 0 };
  const layout = computeViewLayout(
    planeWidth,
    planeHeight,
    viewportWidth,
    viewportHeight,
    fillView,
    viewOrigin,
  );
  const flipY = options.flipY ?? false;
  const bandCount = axes.band >= 0 ? shape[axes.band]! : 1;
  const bandStats = channelRangeNeedsBandStats(options, dtype)
    ? ensurePlaneBandStats(plane)
    : plane.bandStats;

  if (options.mode === "scalar" || bandCount === 1) {
    const [min, max] = resolveScalarRange(options, dtype, bandStats, plane);
    const lut = getColormapLut(options.colormap ?? DEFAULT_COLORMAP);
    const rgba = renderScalarRegionToRgba({
      data,
      planeWidth,
      planeHeight,
      shape,
      axes,
      region: layout.region,
      target: layout.target,
      min,
      max,
      lut,
      flipY,
    });
    putRgbaOnCanvas2d(canvas, rgba, layout.target.width, layout.target.height);
    return { scaleMin: min, scaleMax: max, displayTransform: layout.displayTransform };
  }

  const bandIndices = options.rgbBands;
  const ranges = resolveRgbRanges(options, dtype, bandStats, plane);
  const rgba = renderRgbRegionToRgba({
    data,
    planeWidth,
    planeHeight,
    shape,
    axes,
    region: layout.region,
    target: layout.target,
    bandIndices,
    ranges,
    flipY,
  });
  putRgbaOnCanvas2d(canvas, rgba, layout.target.width, layout.target.height);
  const scaleMin = Math.min(...ranges.map(([min]) => min));
  const scaleMax = Math.max(...ranges.map(([, max]) => max));
  return { scaleMin, scaleMax, displayTransform: layout.displayTransform };
}

export function samplePlaneValues(
  plane: ImagePlane,
  x: number,
  y: number,
  bandLabels: string[] | undefined,
): { bands: Array<{ label: string; value: number }> } {
  const { data, shape, axes } = plane;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  coords[axes.y] = y;
  coords[axes.x] = x;

  if (axes.band < 0) {
    const value = chunkValue(data, stride, coords);
    return { bands: [{ label: "value", value }] };
  }

  const bandCount = shape[axes.band]!;
  const bands: Array<{ label: string; value: number }> = [];
  for (let band = 0; band < bandCount; band++) {
    coords[axes.band] = band;
    const label = bandLabels?.[band] ?? `band ${band}`;
    bands.push({ label, value: chunkValue(data, stride, coords) });
  }
  return { bands };
}

export { canvasToPlanePixel, computeViewLayout };

export function computeDisplaySize(
  planeWidth: number,
  planeHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  fillView: boolean,
): DisplaySize | undefined {
  if (!fillView || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const layout = computeViewLayout(
    planeWidth,
    planeHeight,
    viewportWidth,
    viewportHeight,
    true,
    { x: 0, y: 0 },
  );
  return { width: layout.target.width, height: layout.target.height };
}
