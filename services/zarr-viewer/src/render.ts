import * as zarr from "zarrita";
import { chunkValue, materializeChunk, resolvePlaneAxes } from "./chunk_utils.js";
import type { ImageVariable } from "./dimensions.js";
import { cfScaleBounds, resolveScaleRange } from "./scaling.js";

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

export interface RenderOptions {
  mode: "rgb" | "gray";
  rgbBands: [number, number, number];
  autoscale: boolean;
  attributes: Record<string, unknown>;
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
  mode: "rgb" | "gray" = "gray",
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

export function renderImageToCanvas(
  canvas: HTMLCanvasElement,
  plane: ImagePlane,
  options: RenderOptions,
): void {
  const { data, shape, axes } = plane;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const height = shape[axes.y];
  const width = shape[axes.x];
  if (!Number.isFinite(height) || !Number.isFinite(width) || height <= 0 || width <= 0) {
    throw new Error(`Invalid image plane size: ${width}×${height}`);
  }

  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;
  const { min: cfMin, max: cfMax } = cfScaleBounds(options.attributes);

  canvas.width = width;
  canvas.height = height;

  const image = ctx.createImageData(width, height);
  const pixels = image.data;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);

  if (options.mode === "gray" || bandCount === 1) {
    const samples: number[] = [];
    for (let y = 0; y < height; y++) {
      coords[axes.y] = y;
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = 0;
        samples.push(chunkValue(data, stride, coords));
      }
    }
    const [min, max] = resolveScaleRange(samples, options.autoscale, cfMin, cfMax);
    for (let y = 0; y < height; y++) {
      coords[axes.y] = y;
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = 0;
        const value = normalize(chunkValue(data, stride, coords), min, max);
        const px = (y * width + x) * 4;
        pixels[px] = value;
        pixels[px + 1] = value;
        pixels[px + 2] = value;
        pixels[px + 3] = 255;
      }
    }
  } else {
    const bandIndices = options.rgbBands;
    const channelSamples = bandIndices.map((band) => {
      const samples: number[] = [];
      for (let y = 0; y < height; y++) {
        coords[axes.y] = y;
        for (let x = 0; x < width; x++) {
          coords[axes.x] = x;
          coords[axes.band] = band;
          samples.push(chunkValue(data, stride, coords));
        }
      }
      return samples;
    });

    const ranges = options.autoscale
      ? channelSamples.map((samples) => resolveScaleRange(samples, true, cfMin, cfMax))
      : (() => {
          const merged = channelSamples.flat();
          const shared = resolveScaleRange(merged, false, cfMin, cfMax);
          return [shared, shared, shared] as [number, number][];
        })();

    for (let y = 0; y < height; y++) {
      coords[axes.y] = y;
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        const px = (y * width + x) * 4;
        bandIndices.forEach((band, channel) => {
          coords[axes.band] = band;
          const [min, max] = ranges[channel];
          pixels[px + channel] = normalize(chunkValue(data, stride, coords), min, max);
        });
        pixels[px + 3] = 255;
      }
    }
  }

  ctx.putImageData(image, 0, 0);
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
