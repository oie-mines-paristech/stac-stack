export function chunkIndex(stride: number[], coords: number[]): number {
  let index = 0;
  for (let axis = 0; axis < coords.length; axis++) {
    index += coords[axis]! * stride[axis]!;
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

export type PlaneDtypeTag =
  | "uint8"
  | "int8"
  | "uint16"
  | "int16"
  | "uint32"
  | "int32"
  | "float32"
  | "float64";

export type PlaneData =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array;

export function planeDtypeTagFromString(dtype: string): PlaneDtypeTag {
  const normalized = dtype.toLowerCase();
  if (normalized.includes("float32") || normalized === "single" || normalized.includes("<f4")) {
    return "float32";
  }
  if (normalized.includes("uint8")) return "uint8";
  if (normalized.includes("int8")) return "int8";
  if (normalized.includes("uint16")) return "uint16";
  if (normalized.includes("int16")) return "int16";
  if (normalized.includes("uint32")) return "uint32";
  if (normalized.includes("int32")) return "int32";
  return "float64";
}

/** @deprecated use planeDtypeTagFromString */
export function planeUsesFloat32(dtype: string): boolean {
  return planeDtypeTagFromString(dtype) === "float32";
}

export function createPlaneBuffer(size: number, dtype: string): PlaneData {
  switch (planeDtypeTagFromString(dtype)) {
    case "float32":
      return new Float32Array(size);
    case "uint8":
      return new Uint8Array(size);
    case "int8":
      return new Int8Array(size);
    case "uint16":
      return new Uint16Array(size);
    case "int16":
      return new Int16Array(size);
    case "uint32":
      return new Uint32Array(size);
    case "int32":
      return new Int32Array(size);
    default:
      return new Float64Array(size);
  }
}

function isCOrderStrides(shape: number[], stride: number[]): boolean {
  let step = 1;
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    if (stride[axis] !== step) return false;
    step *= shape[axis]!;
  }
  return true;
}

function copyCOrderChunk(
  data: ArrayLike<number>,
  out: PlaneData,
  size: number,
): boolean {
  if (!ArrayBuffer.isView(data) || data.length !== size) return false;
  out.set(data as PlaneData);
  return true;
}

/** Materialize a zarrita chunk into C-order logical layout, preserving dtype. */
export function materializeChunk(
  data: ArrayLike<number>,
  shape: number[],
  stride: number[],
  dtype = "float64",
): PlaneData {
  const size = shape.reduce((acc, dim) => acc * dim, 1);
  const out = createPlaneBuffer(size, dtype);
  if (isCOrderStrides(shape, stride) && copyCOrderChunk(data, out, size)) {
    return out;
  }

  const rank = shape.length;
  const coords = new Array<number>(rank).fill(0);
  for (let outIdx = 0; outIdx < size; outIdx++) {
    out[outIdx] = data[chunkIndex(stride, coords)]!;
    for (let axis = rank - 1; axis >= 0; axis--) {
      coords[axis]!++;
      if (coords[axis]! < shape[axis]!) break;
      coords[axis] = 0;
    }
  }
  return out;
}

export function computeStrides(shape: number[]): number[] {
  const stride = new Array<number>(shape.length);
  let step = 1;
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    stride[axis] = step;
    step *= shape[axis]!;
  }
  return stride;
}

export function planeDtypeTag(data: PlaneData): PlaneDtypeTag {
  if (data instanceof Float32Array) return "float32";
  if (data instanceof Uint8Array) return "uint8";
  if (data instanceof Int8Array) return "int8";
  if (data instanceof Uint16Array) return "uint16";
  if (data instanceof Int16Array) return "int16";
  if (data instanceof Uint32Array) return "uint32";
  if (data instanceof Int32Array) return "int32";
  return "float64";
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
