import type { ImageVariable } from "./dimensions.js";
import { axisByRole } from "./dimensions.js";
import type { CoordinateMeta, DatasetSchema } from "./dimensions.js";

export const WARN_CHUNK_COUNT = 50;
export const WARN_LOGICAL_BYTES = 50 * 1024 * 1024;

export interface ChunkPlan {
  chunkCount: number;
  logicalBytes: number;
  networkBytes: number;
  chunkShape?: number[];
}

export interface LoadOperationPlan extends ChunkPlan {
  imageChunks: number;
  coordChunks: number;
  imageNetworkBytes: number;
}

export function dtypeByteSize(dtype: string): number {
  const normalized = dtype.toLowerCase();
  if (normalized.includes("64")) return 8;
  if (normalized.includes("32") || normalized.includes("float") || normalized.includes("single")) {
    return 4;
  }
  if (normalized.includes("16")) return 2;
  if (normalized.includes("8")) return 1;
  return 4;
}

function chunkCountAlongAxis(size: number, chunkSize: number, fullSlice: boolean): number {
  const cs = Math.max(1, chunkSize);
  if (fullSlice) return Math.max(1, Math.ceil(size / cs));
  return 1;
}

function chunkCoord(chunkSize: number, index: number): number {
  const cs = Math.max(1, chunkSize);
  return Math.floor(Math.max(0, index) / cs);
}

function chunkCoordsForAxis(
  size: number,
  chunkSize: number,
  fullSlice: boolean,
  index: number,
): number[] {
  const cs = Math.max(1, chunkSize);
  if (fullSlice) {
    const count = Math.max(1, Math.ceil(size / cs));
    return Array.from({ length: count }, (_, i) => i);
  }
  return [chunkCoord(cs, index)];
}

/** Unique chunk grid coordinates for a zarr.get-style selection. */
export function chunkGridKeysForSelection(
  variable: ImageVariable,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): string[] {
  const shape = variable.shape;
  const chunkShape = variable.chunkShape;
  if (!chunkShape || chunkShape.length !== shape.length) {
    return ["unknown"];
  }

  const keys = new Set<string>();
  const axisCoords: number[][] = variable.axes.map((axis, dim) => {
    const size = shape[dim];
    const cs = chunkShape[dim] ?? size;
    if (axis.role === "x" || axis.role === "y") {
      return chunkCoordsForAxis(size, cs, true, 0);
    }
    if (axis.role === "band") {
      if (mode === "rgb") {
        return chunkCoordsForAxis(size, cs, true, 0);
      }
      return chunkCoordsForAxis(size, cs, false, 0);
    }
    const index = selection[axis.name] ?? 0;
    return chunkCoordsForAxis(size, cs, false, index);
  });

  function walk(dim: number, prefix: number[]): void {
    if (dim === axisCoords.length) {
      keys.add(prefix.join(","));
      return;
    }
    for (const coord of axisCoords[dim]) {
      walk(dim + 1, [...prefix, coord]);
    }
  }
  walk(0, []);
  return [...keys];
}

/** Group day time indices by image chunk grid key (union prefetch granularity). */
export function groupTimeIndicesByImageChunk(
  variable: ImageVariable,
  mode: "rgb" | "scalar",
  selection: Record<string, number>,
  timeAxisName: string,
  timeIndices: number[],
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const timeIndex of timeIndices) {
    const sel = { ...selection, [timeAxisName]: timeIndex };
    const chunkKey = chunkGridKeysForSelection(variable, sel, mode)[0] ?? "unknown";
    const bucket = groups.get(chunkKey);
    if (bucket) {
      bucket.push(timeIndex);
    } else {
      groups.set(chunkKey, [timeIndex]);
    }
  }
  for (const indices of groups.values()) {
    indices.sort((a, b) => a - b);
  }
  return groups;
}

function selectionElementCount(
  variable: ImageVariable,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): number {
  let count = 1;
  for (const axis of variable.axes) {
    if (axis.role === "x" || axis.role === "y") {
      count *= axis.size;
      continue;
    }
    if (axis.role === "band") {
      if (mode === "rgb") count *= axis.size;
      continue;
    }
    void selection[axis.name];
  }
  return count;
}

export function planPlaneChunks(
  variable: ImageVariable,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): ChunkPlan {
  const keys = chunkGridKeysForSelection(variable, selection, mode);
  const logicalBytes = selectionElementCount(variable, selection, mode) * dtypeByteSize(variable.dtype);
  const networkBytes = keys.length * networkBytesPerImageChunk(variable);
  return {
    chunkCount: keys.length,
    logicalBytes,
    networkBytes,
    chunkShape: variable.chunkShape,
  };
}

export function networkBytesPerImageChunk(variable: ImageVariable): number {
  if (!variable.chunkShape?.length) {
    return dtypeByteSize(variable.dtype);
  }
  let bytes = dtypeByteSize(variable.dtype);
  for (const size of variable.chunkShape) {
    bytes *= size;
  }
  return bytes;
}

function planCoordArrayChunks(coord: CoordinateMeta, cached: boolean): ChunkPlan {
  if (cached) {
    return { chunkCount: 0, logicalBytes: 0, networkBytes: 0, chunkShape: coord.chunkShape };
  }
  const shape = coord.shape ?? [];
  const chunkShape = coord.chunkShape ?? shape;
  if (shape.length !== 1 || chunkShape.length !== 1) {
    return { chunkCount: 1, logicalBytes: 0, networkBytes: 0, chunkShape };
  }
  const chunkCount = Math.max(1, Math.ceil(shape[0] / Math.max(1, chunkShape[0])));
  const bytesPerElement = dtypeByteSize(coord.dtype ?? "float64");
  const logicalBytes = shape[0] * bytesPerElement;
  const networkBytes = chunkCount * Math.max(1, chunkShape[0]) * bytesPerElement;
  return { chunkCount, logicalBytes, networkBytes, chunkShape };
}

export function planLoadOperation(options: {
  variable: ImageVariable;
  selection: Record<string, number>;
  mode: "rgb" | "scalar";
  schema: DatasetSchema;
  cachedCoordPaths?: Set<string>;
}): LoadOperationPlan {
  const image = planPlaneChunks(options.variable, options.selection, options.mode);
  const cached = options.cachedCoordPaths ?? new Set<string>();
  const coordPaths = new Set<string>();
  for (const axis of options.variable.axes) {
    if (axis.coordinate?.path) coordPaths.add(axis.coordinate.path);
  }

  let coordChunks = 0;
  let coordNetworkBytes = 0;
  for (const path of coordPaths) {
    const coord = options.schema.coordinates[path];
    if (!coord) continue;
    const plan = planCoordArrayChunks(coord, cached.has(path));
    coordChunks += plan.chunkCount;
    coordNetworkBytes += plan.networkBytes;
  }

  const totalChunks = image.chunkCount + coordChunks;
  const networkBytes = image.networkBytes + coordNetworkBytes;

  return {
    imageChunks: image.chunkCount,
    coordChunks,
    chunkCount: totalChunks,
    logicalBytes: image.logicalBytes,
    networkBytes,
    imageNetworkBytes: image.networkBytes,
    chunkShape: image.chunkShape,
  };
}

export function planDayChunks(
  variable: ImageVariable,
  selection: Record<string, number>,
  timeAxisName: string,
  timeIndices: number[],
  mode: "rgb" | "scalar",
): ChunkPlan {
  const keys = new Set<string>();
  for (const timeIndex of timeIndices) {
    const sel = { ...selection, [timeAxisName]: timeIndex };
    for (const key of chunkGridKeysForSelection(variable, sel, mode)) {
      keys.add(key);
    }
  }

  let logicalBytes = 0;
  for (const timeIndex of timeIndices) {
    const sel = { ...selection, [timeAxisName]: timeIndex };
    logicalBytes += planPlaneChunks(variable, sel, mode).logicalBytes;
  }

  return {
    chunkCount: keys.size,
    logicalBytes,
    networkBytes: keys.size * networkBytesPerImageChunk(variable),
    chunkShape: variable.chunkShape,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function formatChunkEstimate(plan: ChunkPlan): string {
  return `${plan.chunkCount} chunks · ~${formatBytes(plan.logicalBytes)}`;
}

export function shouldWarnChunkPlan(
  plan: Pick<ChunkPlan, "chunkCount" | "logicalBytes" | "networkBytes"> & {
    imageChunks?: number;
  },
): boolean {
  const imageChunks = plan.imageChunks ?? plan.chunkCount;
  if (imageChunks === 1) {
    return (
      plan.chunkCount > WARN_CHUNK_COUNT || plan.logicalBytes > WARN_LOGICAL_BYTES
    );
  }
  return (
    plan.chunkCount > WARN_CHUNK_COUNT ||
    plan.logicalBytes > WARN_LOGICAL_BYTES ||
    plan.networkBytes > WARN_LOGICAL_BYTES
  );
}

export function chunkPlanConfirmMessage(plan: LoadOperationPlan): string {
  const wire =
    plan.networkBytes >= 1024 ** 3
      ? `${(plan.networkBytes / 1024 ** 3).toFixed(1)} GB`
      : `${(plan.networkBytes / (1024 * 1024)).toFixed(0)} MB`;
  const frameMb = (plan.logicalBytes / (1024 * 1024)).toFixed(0);
  return `Requested ${plan.imageChunks} chunks (~${wire} on wire) for a ${frameMb} MB frame: This dataset doesn't seem optimized for image preview. Are you sure you want to continue?`;
}

/** @deprecated Use chunkPlanConfirmMessage */
export function chunkPlanWarningMessage(plan: ChunkPlan): string {
  return chunkPlanConfirmMessage({
    ...plan,
    imageChunks: plan.chunkCount,
    coordChunks: 0,
    imageNetworkBytes: plan.networkBytes,
  });
}

/** Fast chunk count product when grid keys are not needed. */
export function estimatePlaneChunkCount(
  variable: ImageVariable,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): number {
  return planPlaneChunks(variable, selection, mode).chunkCount;
}

export function resolveChunkShape(variable: ImageVariable): number[] | undefined {
  if (variable.chunkShape?.length === variable.shape.length) {
    return variable.chunkShape;
  }
  return undefined;
}

export function bandAxisFullSlice(variable: ImageVariable, mode: "rgb" | "scalar"): boolean {
  const bandAxis = axisByRole(variable, "band");
  return mode === "rgb" && bandAxis !== undefined;
}

export function chunkCountAlongAxes(
  shape: number[],
  chunkShape: number[],
  fullAxes: boolean[],
): number {
  let count = 1;
  for (let dim = 0; dim < shape.length; dim++) {
    count *= chunkCountAlongAxis(shape[dim], chunkShape[dim] ?? shape[dim], fullAxes[dim] ?? false);
  }
  return count;
}

export interface SpatialChunkGrid {
  yChunks: number;
  xChunks: number;
  yChunkSize: number;
  xChunkSize: number;
  yAxisIndex: number;
  xAxisIndex: number;
  yAxisSize: number;
  xAxisSize: number;
}

export function spatialChunkGrid(variable: ImageVariable): SpatialChunkGrid | null {
  const yAxis = axisByRole(variable, "y");
  const xAxis = axisByRole(variable, "x");
  const chunkShape = variable.chunkShape;
  if (!yAxis || !xAxis || !chunkShape || chunkShape.length !== variable.shape.length) {
    return null;
  }
  const yChunkSize = chunkShape[yAxis.index] ?? yAxis.size;
  const xChunkSize = chunkShape[xAxis.index] ?? xAxis.size;
  return {
    yChunks: Math.max(1, Math.ceil(yAxis.size / Math.max(1, yChunkSize))),
    xChunks: Math.max(1, Math.ceil(xAxis.size / Math.max(1, xChunkSize))),
    yChunkSize: Math.max(1, yChunkSize),
    xChunkSize: Math.max(1, xChunkSize),
    yAxisIndex: yAxis.index,
    xAxisIndex: xAxis.index,
    yAxisSize: yAxis.size,
    xAxisSize: xAxis.size,
  };
}

export function isSpatiallyMultiChunk(grid: SpatialChunkGrid): boolean {
  return grid.yChunks * grid.xChunks > 1;
}

export function tileIndexRanges(
  grid: SpatialChunkGrid,
  yChunk: number,
  xChunk: number,
): { y: [number, number]; x: [number, number] } {
  return regionIndexRanges(grid, yChunk, yChunk, xChunk, xChunk);
}

export interface SpatialRegionPick {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

export function normalizeRegion(
  grid: SpatialChunkGrid,
  pick: SpatialRegionPick,
): SpatialRegionPick {
  const y0 = Math.max(0, Math.min(pick.y0, pick.y1, grid.yChunks - 1));
  const y1 = Math.max(0, Math.min(Math.max(pick.y0, pick.y1), grid.yChunks - 1));
  const x0 = Math.max(0, Math.min(pick.x0, pick.x1, grid.xChunks - 1));
  const x1 = Math.max(0, Math.min(Math.max(pick.x0, pick.x1), grid.xChunks - 1));
  return { y0, y1, x0, x1 };
}

export function regionIndexRanges(
  grid: SpatialChunkGrid,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
): { y: [number, number]; x: [number, number] } {
  const yStart = y0 * grid.yChunkSize;
  const yEnd = Math.min(y1 * grid.yChunkSize + grid.yChunkSize, grid.yAxisSize);
  const xStart = x0 * grid.xChunkSize;
  const xEnd = Math.min(x1 * grid.xChunkSize + grid.xChunkSize, grid.xAxisSize);
  return { y: [yStart, yEnd], x: [xStart, xEnd] };
}

export function planSpatialRegion(
  variable: ImageVariable,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
): LoadOperationPlan {
  const grid = spatialChunkGrid(variable);
  if (!grid) {
    throw new Error("Cannot plan spatial region without chunk grid metadata");
  }
  const region = normalizeRegion(grid, { y0, y1, x0, x1 });
  const yCount = region.y1 - region.y0 + 1;
  const xCount = region.x1 - region.x0 + 1;
  const imageChunks = yCount * xCount;
  const ranges = regionIndexRanges(grid, region.y0, region.y1, region.x0, region.x1);
  const elements = (ranges.y[1] - ranges.y[0]) * (ranges.x[1] - ranges.x[0]);
  const logicalBytes = elements * dtypeByteSize(variable.dtype);
  const perChunk = networkBytesPerImageChunk(variable);
  const networkBytes = imageChunks * perChunk;
  return {
    imageChunks,
    coordChunks: 0,
    chunkCount: imageChunks,
    logicalBytes,
    networkBytes,
    imageNetworkBytes: networkBytes,
    chunkShape: variable.chunkShape,
  };
}

export function planSingleSpatialTile(
  variable: ImageVariable,
  yChunk: number,
  xChunk: number,
): LoadOperationPlan {
  return planSpatialRegion(variable, yChunk, yChunk, xChunk, xChunk);
}

export function formatRegionLoadEstimate(plan: LoadOperationPlan): string {
  const wire =
    plan.imageNetworkBytes >= 1024 ** 3
      ? `${(plan.imageNetworkBytes / 1024 ** 3).toFixed(1)} GB`
      : `${(plan.imageNetworkBytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${plan.imageChunks} chunks · ~${formatBytes(plan.logicalBytes)} decoded · ~${wire} on wire`;
}

export function chunkPickerSpatialMessage(plan: LoadOperationPlan, grid: SpatialChunkGrid): string {
  const wire =
    plan.imageNetworkBytes >= 1024 ** 3
      ? `${(plan.imageNetworkBytes / 1024 ** 3).toFixed(1)} GB`
      : `${(plan.imageNetworkBytes / (1024 * 1024)).toFixed(0)} MB`;
  const frameMb = (plan.logicalBytes / (1024 * 1024)).toFixed(0);
  return (
    `This dataset isn't optimized for image preview (${grid.yChunks}×${grid.xChunks} spatial tiles, ` +
    `full frame ~${plan.imageChunks} chunks / ~${wire} on wire / ${frameMb} MB decoded). ` +
    `Select an area to load (click or drag on the grid).`
  );
}
