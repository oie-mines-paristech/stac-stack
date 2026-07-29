export function chunkIndex(stride: number[], coords: number[]): number {
  let index = 0;
  for (let axis = 0; axis < coords.length; axis++) {
    index += coords[axis] * stride[axis];
  }
  return index;
}

export function chunkValue(
  data: ArrayLike<number>,
  stride: number[],
  coords: number[],
): number {
  return data[chunkIndex(stride, coords)] as number;
}

export type PlaneData = Float32Array | Float64Array;

export function planeUsesFloat32(dtype: string): boolean {
  const normalized = dtype.toLowerCase();
  return normalized.includes("float32") || normalized === "single" || normalized.includes("<f4");
}

export function createPlaneBuffer(size: number, dtype: string): PlaneData {
  return planeUsesFloat32(dtype) ? new Float32Array(size) : new Float64Array(size);
}

/** Materialize a zarrita chunk into C-order logical layout. */
export function materializeChunk(
  data: ArrayLike<number>,
  shape: number[],
  stride: number[],
  dtype = "float64",
): PlaneData {
  const out = createPlaneBuffer(shape.reduce((acc, size) => acc * size, 1), dtype);
  const coords = new Array<number>(shape.length).fill(0);
  let outIdx = 0;

  function walk(axis: number): void {
    if (axis === shape.length) {
      out[outIdx++] = data[chunkIndex(stride, coords)];
      return;
    }
    for (let i = 0; i < shape[axis]; i++) {
      coords[axis] = i;
      walk(axis + 1);
    }
  }

  walk(0);
  return out;
}

export interface ImageAxes {
  time: number;
  band: number;
  y: number;
  x: number;
}

/** Map CF axis roles onto the actual plane shape returned by zarr.get(). */
export function resolvePlaneAxes(
  variable: { axes: ReadonlyArray<{ role: string }> },
  planeShape: number[],
  includeBand: boolean,
): ImageAxes {
  const axes: ImageAxes = { time: -1, band: -1, y: -1, x: -1 };
  let planeDim = 0;

  for (const axis of variable.axes) {
    if (axis.role === "y" || axis.role === "x") {
      axes[axis.role] = planeDim++;
      continue;
    }
    if (axis.role === "band" && includeBand) {
      axes.band = planeDim++;
    }
  }

  if (planeDim !== planeShape.length) {
    if (planeShape.length === 2) {
      return { time: -1, band: -1, y: 0, x: 1 };
    }
    if (planeShape.length === 3) {
      return { time: -1, band: 0, y: 1, x: 2 };
    }
  }

  return axes;
}
