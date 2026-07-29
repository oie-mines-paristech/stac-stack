import * as zarr from "zarrita";
import { chunkValue, materializeChunk, resolvePlaneAxes } from "./chunk_utils.js";
import { DEFAULT_COLORMAP, getColormapLut } from "./colormap.js";
import type { ImageVariable } from "./dimensions.js";
import {
  cfScaleBounds,
  percentileMinMax,
  resolveManualScaleRange,
  resolveScaleRange,
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
  data: Float64Array;
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
): Promise<ImagePlane> {
  const selection = variable.axes.map((axis, dim) => {
    if (axis.role === "x" || axis.role === "y") {
      return zarr.slice(null);
    }
    if (axis.role === "band" && mode === "rgb") {
      return zarr.slice(null);
    }
    return indices[dim] ?? 0;
  });

  const chunk = await zarr.get(arr, selection);
  const shape = [...chunk.shape];
  const logical = materializeChunk(
    chunk.data as ArrayLike<number>,
    shape,
    [...chunk.stride],
  );
  const axes = resolvePlaneAxes(variable, shape, mode === "rgb");
  return { data: logical, shape, axes };
}

export function collectPlaneBandSamples(plane: ImagePlane, flipY: boolean): number[][] {
  const { data, shape, axes } = plane;
  const height = shape[axes.y];
  const width = shape[axes.x];
  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  const result: number[][] = [];

  for (let band = 0; band < bandCount; band++) {
    const samples: number[] = [];
    for (let canvasY = 0; canvasY < height; canvasY++) {
      coords[axes.y] = dataRowFromCanvas(canvasY, height, flipY);
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = band;
        samples.push(chunkValue(data, stride, coords));
      }
    }
    result.push(samples);
  }
  return result;
}

export function autoscaleRangesFromPlane(
  plane: ImagePlane,
  flipY: boolean,
  attributes: Record<string, unknown>,
): ScaleRange[] {
  const { min: cfMin, max: cfMax } = cfScaleBounds(attributes);
  return collectPlaneBandSamples(plane, flipY).map((samples) => {
    const [min, max] = percentileMinMax(samples, 5, 95);
    if (cfMin !== undefined && cfMax !== undefined && cfMax > cfMin) {
      return {
        min: Math.max(min, cfMin),
        max: Math.min(max, cfMax),
      };
    }
    return { min, max };
  });
}

function bandScaleRange(
  samples: number[],
  options: RenderOptions,
  bandIndex: number,
  cfMin: unknown,
  cfMax: unknown,
): [number, number] {
  if (options.autoscale) {
    return resolveScaleRange(samples, true, cfMin, cfMax);
  }
  return resolveManualScaleRange(options.manualRanges?.[bandIndex], samples, cfMin, cfMax);
}

export function renderImageToCanvas(
  canvas: HTMLCanvasElement,
  plane: ImagePlane,
  options: RenderOptions,
): RenderResult {
  const { data, shape, axes } = plane;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { scaleMin: 0, scaleMax: 1 };

  const height = shape[axes.y];
  const width = shape[axes.x];
  if (!Number.isFinite(height) || !Number.isFinite(width) || height <= 0 || width <= 0) {
    throw new Error(`Invalid image plane size: ${width}×${height}`);
  }

  const flipY = options.flipY ?? false;
  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;
  const { min: cfMin, max: cfMax } = cfScaleBounds(options.attributes);

  canvas.width = width;
  canvas.height = height;

  const image = ctx.createImageData(width, height);
  const pixels = image.data;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);

  if (options.mode === "scalar" || bandCount === 1) {
    const samples: number[] = [];
    for (let canvasY = 0; canvasY < height; canvasY++) {
      coords[axes.y] = dataRowFromCanvas(canvasY, height, flipY);
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = 0;
        samples.push(chunkValue(data, stride, coords));
      }
    }
    const [min, max] = bandScaleRange(samples, options, 0, cfMin, cfMax);
    const lut = getColormapLut(options.colormap ?? DEFAULT_COLORMAP);
    for (let canvasY = 0; canvasY < height; canvasY++) {
      coords[axes.y] = dataRowFromCanvas(canvasY, height, flipY);
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = 0;
        const raw = chunkValue(data, stride, coords);
        const t = normalize(raw, min, max) / 255;
        const index = Math.min(255, Math.max(0, Math.round(t * 255)));
        const px = (canvasY * width + x) * 4;
        pixels[px] = lut[index * 3];
        pixels[px + 1] = lut[index * 3 + 1];
        pixels[px + 2] = lut[index * 3 + 2];
        pixels[px + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return { scaleMin: min, scaleMax: max };
  }

  const bandIndices = options.rgbBands;
  const channelSamples = bandIndices.map((band) => {
    const samples: number[] = [];
    for (let canvasY = 0; canvasY < height; canvasY++) {
      coords[axes.y] = dataRowFromCanvas(canvasY, height, flipY);
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        coords[axes.band] = band;
        samples.push(chunkValue(data, stride, coords));
      }
    }
    return samples;
  });

  const ranges = channelSamples.map((samples, channel) =>
    bandScaleRange(samples, options, bandIndices[channel], cfMin, cfMax),
  );

  for (let canvasY = 0; canvasY < height; canvasY++) {
    coords[axes.y] = dataRowFromCanvas(canvasY, height, flipY);
    for (let x = 0; x < width; x++) {
      coords[axes.x] = x;
      const px = (canvasY * width + x) * 4;
      bandIndices.forEach((band, channel) => {
        coords[axes.band] = band;
        const [min, max] = ranges[channel];
        pixels[px + channel] = normalize(chunkValue(data, stride, coords), min, max);
      });
      pixels[px + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const scaleMin = Math.min(...ranges.map(([min]) => min));
  const scaleMax = Math.max(...ranges.map(([, max]) => max));
  return { scaleMin, scaleMax };
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
