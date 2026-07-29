import * as zarr from "zarrita";
import { loadFullPlane, type SpatialRegionSelection } from "./array_load.js";
import { spatialChunkGrid, type SpatialRegionPick } from "./chunk_plan.js";
import { chunkValue, resolvePlaneAxes, type PlaneData } from "./chunk_utils.js";
import { DEFAULT_COLORMAP, getColormapLut } from "./colormap.js";
import type { ImageVariable } from "./dimensions.js";
import { putRgbaOnCanvas2d, renderRgbRegionToRgba, renderScalarRegionToRgba } from "./render_core.js";
import {
  arrayMinMax,
  cfScaleBounds,
  resolveManualScaleRange,
  type ScaleRange,
} from "./scaling.js";
import { dataRowFromCanvas } from "./spatial.js";
import {
  canvasToPlanePixel,
  computeViewLayout,
  type DisplayTransform,
  type DisplaySize,
  type ViewLayout,
  type ViewOrigin,
} from "./view_transform.js";

export type { DisplaySize, DisplayTransform, ViewLayout, ViewOrigin };

export interface ImagePlane {
  data: PlaneData;
  shape: number[];
  axes: ReturnType<typeof resolvePlaneAxes>;
}

export function countFiniteSamples(plane: ImagePlane): number {
  let count = 0;
  for (const value of plane.data) {
    if (Number.isFinite(value)) count++;
  }
  return count;
}

export interface RenderOptions {
  mode: "rgb" | "scalar";
  rgbBands: [number, number, number];
  autoscale: boolean;
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

export function autoscaleRangesFromPlane(
  plane: ImagePlane,
  flipY: boolean,
  attributes: Record<string, unknown>,
): ScaleRange[] {
  const { min: cfMin, max: cfMax } = cfScaleBounds(attributes);
  const { data, shape, axes } = plane;
  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;
  const height = shape[axes.y];
  const width = shape[axes.x];
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  const ranges: ScaleRange[] = [];

  for (let band = 0; band < bandCount; band++) {
    let min = Infinity;
    let max = -Infinity;
    for (let canvasY = 0; canvasY < height; canvasY++) {
      coords[axes.y] = dataRowFromCanvas(canvasY, height, flipY);
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = band;
        const value = chunkValue(data, stride, coords);
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      ranges.push({ min: 0, max: 1 });
      continue;
    }
    if (cfMin !== undefined && cfMax !== undefined && cfMax > cfMin) {
      ranges.push({
        min: Math.max(min, cfMin),
        max: Math.min(max, cfMax),
      });
    } else {
      ranges.push({ min, max: min === max ? max + 1 : max });
    }
  }
  return ranges;
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
): RenderResult {
  const { data, shape, axes } = plane;
  const planeHeight = shape[axes.y];
  const planeWidth = shape[axes.x];
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
  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;
  const { min: cfMin, max: cfMax } = cfScaleBounds(options.attributes);

  if (options.mode === "scalar" || bandCount === 1) {
    const [min, max] = options.autoscale
      ? arrayMinMax(data)
      : resolveManualScaleRange(options.manualRanges?.[0], data, cfMin, cfMax);
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
  const ranges = bandIndices.map((band, channel) => {
    if (options.autoscale) {
      if (axes.band >= 0 && shape.length === 3) {
        const bandHeight = shape[axes.y];
        const bandWidth = shape[axes.x];
        const bandStride = band * bandHeight * bandWidth;
        return arrayMinMax(data.subarray(bandStride, bandStride + bandHeight * bandWidth));
      }
      return arrayMinMax(data);
    }
    return resolveManualScaleRange(options.manualRanges?.[channel], data, cfMin, cfMax);
  });

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

  const bandCount = shape[axes.band];
  const bands: Array<{ label: string; value: number }> = [];
  for (let band = 0; band < bandCount; band++) {
    coords[axes.band] = band;
    const label = bandLabels?.[band] ?? `band ${band}`;
    bands.push({ label, value: chunkValue(data, stride, coords) });
  }
  return { bands };
}

function computeStrides(shape: number[]): number[] {
  const stride = new Array<number>(shape.length);
  let step = 1;
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    stride[axis] = step;
    step *= shape[axis];
  }
  return stride;
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
