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

/** Materialize a zarrita chunk into C-order logical layout. */
export function materializeChunk(
  data: ArrayLike<number>,
  shape: number[],
  stride: number[],
): Float64Array {
  const out = new Float64Array(shape.reduce((acc, size) => acc * size, 1));
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
