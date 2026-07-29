import * as zarr from "zarrita";
import { loadFullPlane, type SpatialRegionSelection } from "./array_load.js";
import { spatialChunkGrid, type SpatialRegionPick } from "./chunk_plan.js";
import { chunkValue, resolvePlaneAxes, type PlaneData } from "./chunk_utils.js";
import { DEFAULT_COLORMAP, getColormapLut } from "./colormap.js";
import type { ImageVariable } from "./dimensions.js";
import {
  arrayMinMax,
  cfScaleBounds,
  resolveManualScaleRange,
  type ScaleRange,
} from "./scaling.js";
import { dataRowFromCanvas } from "./spatial.js";

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  const scaled = ((value - min) / (max - min)) * 255;
  return Math.max(0, Math.min(255, scaled));
}

export interface ImagePlane {
  data: PlaneData;
  shape: number[];
  axes: ReturnType<typeof resolvePlaneAxes>;
}

export interface DisplaySize {
  width: number;
  height: number;
}

export interface DisplayTransform {
  planeWidth: number;
  planeHeight: number;
  canvasWidth: number;
  canvasHeight: number;
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

function sourcePixel(
  ox: number,
  oy: number,
  outWidth: number,
  outHeight: number,
  planeWidth: number,
  planeHeight: number,
): { x: number; y: number } {
  const srcX = Math.min(
    planeWidth - 1,
    Math.floor(((ox + 0.5) * planeWidth) / outWidth),
  );
  const canvasRow = Math.min(
    planeHeight - 1,
    Math.floor(((oy + 0.5) * planeHeight) / outHeight),
  );
  return { x: srcX, y: canvasRow };
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

export function renderImageToCanvas(
  canvas: HTMLCanvasElement,
  plane: ImagePlane,
  options: RenderOptions,
  displaySize?: DisplaySize,
): RenderResult {
  const { data, shape, axes } = plane;
  const ctx = canvas.getContext("2d");
  const planeHeight = shape[axes.y];
  const planeWidth = shape[axes.x];
  const displayTransform: DisplayTransform = {
    planeWidth,
    planeHeight,
    canvasWidth: planeWidth,
    canvasHeight: planeHeight,
  };

  if (!ctx || !Number.isFinite(planeHeight) || !Number.isFinite(planeWidth) || planeHeight <= 0 || planeWidth <= 0) {
    return { scaleMin: 0, scaleMax: 1, displayTransform };
  }

  const flipY = options.flipY ?? false;
  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;
  const { min: cfMin, max: cfMax } = cfScaleBounds(options.attributes);

  const outWidth = displaySize
    ? Math.max(1, Math.min(displaySize.width, planeWidth))
    : planeWidth;
  const outHeight = displaySize
    ? Math.max(1, Math.min(displaySize.height, planeHeight))
    : planeHeight;

  canvas.width = outWidth;
  canvas.height = outHeight;
  displayTransform.canvasWidth = outWidth;
  displayTransform.canvasHeight = outHeight;

  const image = ctx.createImageData(outWidth, outHeight);
  const pixels = image.data;
  const fullResolution = outWidth === planeWidth && outHeight === planeHeight;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);

  if (options.mode === "scalar" || bandCount === 1) {
    const [min, max] = options.autoscale
      ? arrayMinMax(data)
      : resolveManualScaleRange(options.manualRanges?.[0], data, cfMin, cfMax);
    const lut = getColormapLut(options.colormap ?? DEFAULT_COLORMAP);

    if (fullResolution && axes.band < 0 && shape.length === 2) {
      for (let canvasY = 0; canvasY < outHeight; canvasY++) {
        const dataY = dataRowFromCanvas(canvasY, planeHeight, flipY);
        const rowOffset = dataY * planeWidth;
        for (let x = 0; x < outWidth; x++) {
          const raw = data[rowOffset + x]!;
          const index = Math.min(255, Math.max(0, Math.round(normalize(raw, min, max))));
          const px = (canvasY * outWidth + x) * 4;
          pixels[px] = lut[index * 3]!;
          pixels[px + 1] = lut[index * 3 + 1]!;
          pixels[px + 2] = lut[index * 3 + 2]!;
          pixels[px + 3] = 255;
        }
      }
    } else {
      for (let oy = 0; oy < outHeight; oy++) {
        for (let ox = 0; ox < outWidth; ox++) {
          const src = sourcePixel(ox, oy, outWidth, outHeight, planeWidth, planeHeight);
          coords[axes.y] = dataRowFromCanvas(src.y, planeHeight, flipY);
          coords[axes.x] = src.x;
          if (axes.band >= 0) coords[axes.band] = 0;
          const raw = chunkValue(data, stride, coords);
          const index = Math.min(255, Math.max(0, Math.round(normalize(raw, min, max))));
          const px = (oy * outWidth + ox) * 4;
          pixels[px] = lut[index * 3]!;
          pixels[px + 1] = lut[index * 3 + 1]!;
          pixels[px + 2] = lut[index * 3 + 2]!;
          pixels[px + 3] = 255;
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    return { scaleMin: min, scaleMax: max, displayTransform };
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

  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const src = fullResolution
        ? { x: ox, y: oy }
        : sourcePixel(ox, oy, outWidth, outHeight, planeWidth, planeHeight);
      coords[axes.y] = dataRowFromCanvas(src.y, planeHeight, flipY);
      coords[axes.x] = src.x;
      const px = (oy * outWidth + ox) * 4;
      bandIndices.forEach((band, channel) => {
        coords[axes.band] = band;
        const [min, max] = ranges[channel]!;
        pixels[px + channel] = normalize(chunkValue(data, stride, coords), min, max);
      });
      pixels[px + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const scaleMin = Math.min(...ranges.map(([min]) => min));
  const scaleMax = Math.max(...ranges.map(([, max]) => max));
  return { scaleMin, scaleMax, displayTransform };
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

export function canvasToPlanePixel(
  canvasX: number,
  canvasY: number,
  transform: DisplayTransform,
  flipY: boolean,
): { x: number; y: number } {
  const x = Math.max(
    0,
    Math.min(
      transform.planeWidth - 1,
      Math.floor((canvasX * transform.planeWidth) / Math.max(1, transform.canvasWidth)),
    ),
  );
  const canvasRow = Math.max(
    0,
    Math.min(
      transform.planeHeight - 1,
      Math.floor((canvasY * transform.planeHeight) / Math.max(1, transform.canvasHeight)),
    ),
  );
  const y = dataRowFromCanvas(canvasRow, transform.planeHeight, flipY);
  return { x, y };
}

export function computeDisplaySize(
  planeWidth: number,
  planeHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  fillView: boolean,
): DisplaySize | undefined {
  if (!fillView || viewportWidth <= 0 || viewportHeight <= 0) return undefined;
  const scale = Math.min(viewportWidth / planeWidth, viewportHeight / planeHeight);
  return {
    width: Math.max(1, Math.floor(planeWidth * scale)),
    height: Math.max(1, Math.floor(planeHeight * scale)),
  };
}
