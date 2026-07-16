import { chunkValue } from "./chunk_utils.js";
import type { ImagePlane } from "./render.js";

export interface SpatialCoords {
  xName: string;
  yName: string;
  xValues: number[] | null;
  yValues: number[] | null;
}

export function formatHoverLine(
  plane: ImagePlane,
  pixelX: number,
  pixelY: number,
  spatial: SpatialCoords | null,
  bandLabels: string[] | undefined,
): string {
  const { shape, axes, data } = plane;
  const width = shape[axes.x];
  const height = shape[axes.y];
  const x = Math.max(0, Math.min(width - 1, pixelX));
  const y = Math.max(0, Math.min(height - 1, pixelY));

  const parts: string[] = [`idx x:${x} y:${y}`];
  if (spatial?.xValues && x < spatial.xValues.length) {
    parts.push(`${spatial.xName}:${formatCoord(spatial.xValues[x])}`);
  }
  if (spatial?.yValues && y < spatial.yValues.length) {
    parts.push(`${spatial.yName}:${formatCoord(spatial.yValues[y])}`);
  }

  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  coords[axes.y] = y;
  coords[axes.x] = x;

  if (axes.band < 0) {
    const value = chunkValue(data, stride, coords);
    parts.push(`value:${formatCoord(value)}`);
  } else {
    const bandCount = shape[axes.band];
    for (let band = 0; band < bandCount; band++) {
      coords[axes.band] = band;
      const label = bandLabels?.[band] ?? `band${band}`;
      parts.push(`${label}:${formatCoord(chunkValue(data, stride, coords))}`);
    }
  }

  return parts.join(" · ");
}

function formatCoord(value: number): string {
  if (!Number.isFinite(value)) return "NaN";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/\.?0+$/, "");
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

export function canvasPixelCoords(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  return { x, y };
}
