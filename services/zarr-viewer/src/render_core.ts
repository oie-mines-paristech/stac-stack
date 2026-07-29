import { chunkValue, type PlaneData } from "./chunk_utils.js";
import { dataRowFromCanvas } from "./spatial.js";
import type { RenderRegion, RenderTarget } from "./view_transform.js";

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  const scaled = ((value - min) / (max - min)) * 255;
  return Math.max(0, Math.min(255, scaled));
}

function sourcePixelInRegion(
  ox: number,
  oy: number,
  outWidth: number,
  outHeight: number,
  region: RenderRegion,
): { x: number; y: number } {
  const srcX = Math.min(
    region.width - 1,
    Math.floor(((ox + 0.5) * region.width) / outWidth),
  );
  const srcY = Math.min(
    region.height - 1,
    Math.floor(((oy + 0.5) * region.height) / outHeight),
  );
  return { x: region.x0 + srcX, y: region.y0 + srcY };
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

export interface ScalarRenderParams {
  data: PlaneData;
  planeWidth: number;
  planeHeight: number;
  shape: number[];
  axes: { x: number; y: number; band: number };
  region: RenderRegion;
  target: RenderTarget;
  min: number;
  max: number;
  lut: Uint8Array;
  flipY: boolean;
}

export function renderScalarRegionToRgba(params: ScalarRenderParams): Uint8ClampedArray {
  const {
    data,
    planeWidth,
    planeHeight,
    shape,
    axes,
    region,
    target,
    min,
    max,
    lut,
    flipY,
  } = params;

  const outWidth = target.width;
  const outHeight = target.height;
  const pixels = new Uint8ClampedArray(outWidth * outHeight * 4);
  const fullResolution =
    outWidth === region.width &&
    outHeight === region.height &&
    region.x0 === 0 &&
    region.y0 === 0 &&
    region.width === planeWidth &&
    region.height === planeHeight;

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
    return pixels;
  }

  const regionMatchesTarget =
    outWidth === region.width &&
    outHeight === region.height &&
    axes.band < 0 &&
    shape.length === 2;

  if (regionMatchesTarget) {
    for (let oy = 0; oy < outHeight; oy++) {
      const srcY = region.y0 + oy;
      const dataY = dataRowFromCanvas(srcY, planeHeight, flipY);
      const rowOffset = dataY * planeWidth + region.x0;
      for (let ox = 0; ox < outWidth; ox++) {
        const raw = data[rowOffset + ox]!;
        const index = Math.min(255, Math.max(0, Math.round(normalize(raw, min, max))));
        const px = (oy * outWidth + ox) * 4;
        pixels[px] = lut[index * 3]!;
        pixels[px + 1] = lut[index * 3 + 1]!;
        pixels[px + 2] = lut[index * 3 + 2]!;
        pixels[px + 3] = 255;
      }
    }
    return pixels;
  }

  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const src = sourcePixelInRegion(ox, oy, outWidth, outHeight, region);
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
  return pixels;
}

export interface RgbRenderParams {
  data: PlaneData;
  planeWidth: number;
  planeHeight: number;
  shape: number[];
  axes: { x: number; y: number; band: number };
  region: RenderRegion;
  target: RenderTarget;
  bandIndices: [number, number, number];
  ranges: Array<[number, number]>;
  flipY: boolean;
}

export function renderRgbRegionToRgba(params: RgbRenderParams): Uint8ClampedArray {
  const {
    data,
    planeHeight,
    shape,
    axes,
    region,
    target,
    bandIndices,
    ranges,
    flipY,
  } = params;

  const outWidth = target.width;
  const outHeight = target.height;
  const pixels = new Uint8ClampedArray(outWidth * outHeight * 4);
  const fullResolution = outWidth === region.width && outHeight === region.height;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);

  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      const src = fullResolution
        ? { x: region.x0 + ox, y: region.y0 + oy }
        : sourcePixelInRegion(ox, oy, outWidth, outHeight, region);
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
  return pixels;
}

export function putRgbaOnCanvas2d(
  canvas: HTMLCanvasElement,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
}
