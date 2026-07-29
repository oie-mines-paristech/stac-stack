import * as zarr from "zarrita";
import { materializeChunk } from "./chunk_utils.js";
import { regionIndexRanges, type SpatialChunkGrid } from "./chunk_plan.js";
import type { ImageVariable } from "./dimensions.js";

export interface SpatialRegionSelection {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  grid: SpatialChunkGrid;
}

/** @deprecated use SpatialRegionSelection */
export type SpatialTileSelection = SpatialRegionSelection;

export function shapeProduct(shape: number[]): number {
  return shape.reduce((acc, size) => acc * size, 1);
}

export function shapesEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((size, index) => size === b[index]);
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

/** Read a 1D coordinate array in full, with slice-by-chunk fallback. */
export async function loadFull1DArray(node: zarr.Array<zarr.DataType>): Promise<unknown[]> {
  const shape = [...node.shape];
  if (shape.length !== 1) {
    throw new Error(`Expected 1D coordinate array, got shape [${shape.join(", ")}]`);
  }
  const size = shape[0];

  const chunk = await zarr.get(node, [zarr.slice(null)]);
  const data = Array.from(chunk.data as ArrayLike<unknown>);
  if (data.length === size) return data;

  const chunkSize = node.chunks[0] ?? size;
  const out = new Array<unknown>(size);
  const chunkCount = Math.max(1, Math.ceil(size / chunkSize));

  for (let index = 0; index < chunkCount; index++) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, size);
    const part = await zarr.get(node, [zarr.slice(start, end)]);
    const values = Array.from(part.data as ArrayLike<unknown>);
    for (let offset = 0; offset < values.length; offset++) {
      out[start + offset] = values[offset];
    }
  }

  return out;
}

export type ZarrSelection = (number | ReturnType<typeof zarr.slice> | null)[];

type ZarrSlice = ReturnType<typeof zarr.slice>;

function sliceBounds(sel: ZarrSlice, axisSize: number): { start: number; stop: number } {
  return {
    start: sel.start ?? 0,
    stop: sel.stop ?? axisSize,
  };
}

/** Chunk index range covered by a bounded zarr slice on one axis. */
export function chunkRangeForSlice(
  axisSize: number,
  chunkSize: number,
  sliceStart: number,
  sliceStop: number,
): { first: number; last: number } {
  const cs = Math.max(1, chunkSize);
  const first = Math.floor(sliceStart / cs);
  const last = Math.floor(Math.max(sliceStart, sliceStop - 1) / cs);
  return { first, last: Math.min(last, Math.max(0, Math.ceil(axisSize / cs) - 1)) };
}

export function buildZarrSelection(
  variable: ImageVariable,
  indices: number[],
  mode: "rgb" | "scalar",
  spatialRegion?: SpatialRegionSelection,
): ZarrSelection {
  const regionRanges = spatialRegion
    ? regionIndexRanges(
        spatialRegion.grid,
        spatialRegion.y0,
        spatialRegion.y1,
        spatialRegion.x0,
        spatialRegion.x1,
      )
    : null;

  return variable.axes.map((axis, dim) => {
    if (regionRanges && axis.role === "y" && dim === spatialRegion!.grid.yAxisIndex) {
      return zarr.slice(regionRanges.y[0], regionRanges.y[1]);
    }
    if (regionRanges && axis.role === "x" && dim === spatialRegion!.grid.xAxisIndex) {
      return zarr.slice(regionRanges.x[0], regionRanges.x[1]);
    }
    if (axis.role === "x" || axis.role === "y") {
      return zarr.slice(null);
    }
    if (axis.role === "band" && mode === "rgb") {
      return zarr.slice(null);
    }
    return indices[dim] ?? 0;
  });
}

export function expectedPlaneShape(
  variable: ImageVariable,
  _indices: number[],
  mode: "rgb" | "scalar",
  spatialRegion?: SpatialRegionSelection,
): number[] {
  const regionRanges = spatialRegion
    ? regionIndexRanges(
        spatialRegion.grid,
        spatialRegion.y0,
        spatialRegion.y1,
        spatialRegion.x0,
        spatialRegion.x1,
      )
    : null;
  const shape: number[] = [];
  for (const axis of variable.axes) {
    if (axis.role === "x" || axis.role === "y") {
      if (regionRanges) {
        const range = axis.role === "y" ? regionRanges.y : regionRanges.x;
        shape.push(range[1] - range[0]);
      } else {
        shape.push(axis.size);
      }
      continue;
    }
    if (axis.role === "band" && mode === "rgb") {
      shape.push(axis.size);
    }
  }
  return shape;
}

export interface LoadedPlaneChunk {
  data: Float64Array;
  shape: number[];
  stride: number[];
}

async function loadPlaneByTiles(
  arr: zarr.Array<zarr.DataType>,
  variable: ImageVariable,
  indices: number[],
  mode: "rgb" | "scalar",
  expectedShape: number[],
  spatialRegion?: SpatialRegionSelection,
): Promise<LoadedPlaneChunk> {
  const chunkShape = variable.chunkShape;
  if (!chunkShape || chunkShape.length !== variable.shape.length) {
    throw new Error("Cannot assemble plane without chunk_shape metadata");
  }
  const gridChunkShape = chunkShape;

  const selection = buildZarrSelection(variable, indices, mode, spatialRegion);
  const out = new Float64Array(shapeProduct(expectedShape));
  const outShape = [...expectedShape];
  const outStride = computeStrides(outShape);

  const planeVarDims: number[] = [];
  for (let dim = 0; dim < variable.axes.length; dim++) {
    const sel = selection[dim];
    if (sel !== null && typeof sel !== "number") {
      planeVarDims.push(dim);
    }
  }

  const tileStarts: number[] = [];
  const tileCounts: number[] = [];
  const regionStarts: number[] = [];

  for (const dim of planeVarDims) {
    const sel = selection[dim] as ZarrSlice;
    const axisSize = variable.shape[dim];
    const cs = gridChunkShape[dim] ?? axisSize;
    const bounds = sliceBounds(sel, axisSize);
    const range = chunkRangeForSlice(axisSize, cs, bounds.start, bounds.stop);
    tileStarts.push(range.first);
    tileCounts.push(range.last - range.first + 1);
    regionStarts.push(bounds.start);
  }

  async function walkPlaneDim(planeAxis: number, coords: number[]): Promise<void> {
    if (planeAxis === planeVarDims.length) {
      const tileSelection = variable.axes.map((_, dim) => {
        const sel = selection[dim];
        if (typeof sel === "number") return sel;
        const planeIndex = planeVarDims.indexOf(dim);
        const cc = coords[planeIndex];
        const cs = gridChunkShape[dim] ?? variable.shape[dim];
        const start = cc * cs;
        const end = Math.min(start + cs, variable.shape[dim]);
        return zarr.slice(start, end);
      });

      const tile = await zarr.get(arr, tileSelection);
      const tileShape = [...tile.shape];
      const tileData = materializeChunk(
        tile.data as ArrayLike<number>,
        tileShape,
        [...tile.stride],
      );
      const tileStride = computeStrides(tileShape);

      const offsets = coords.map((coord, planeIndex) => {
        const varDim = planeVarDims[planeIndex];
        const cs = gridChunkShape[varDim] ?? variable.shape[varDim];
        return coord * cs - regionStarts[planeIndex];
      });

      const tileCoords = new Array<number>(tileShape.length).fill(0);
      function copyWalk(axis: number): void {
        if (axis === tileShape.length) {
          let outIdx = 0;
          for (let d = 0; d < outShape.length; d++) {
            outIdx += (offsets[d] + tileCoords[d]) * outStride[d];
          }
          let tileIdx = 0;
          for (let d = 0; d < tileShape.length; d++) {
            tileIdx += tileCoords[d] * tileStride[d];
          }
          out[outIdx] = tileData[tileIdx];
          return;
        }
        for (let i = 0; i < tileShape[axis]; i++) {
          tileCoords[axis] = i;
          copyWalk(axis + 1);
        }
      }
      copyWalk(0);
      return;
    }

    for (let c = 0; c < tileCounts[planeAxis]; c++) {
      await walkPlaneDim(planeAxis + 1, [...coords, tileStarts[planeAxis] + c]);
    }
  }

  await walkPlaneDim(0, []);
  return { data: out, shape: outShape, stride: outStride };
}

/** Load an image plane slice; validates shape and falls back to tile assembly. */
export async function loadFullPlane(
  arr: zarr.Array<zarr.DataType>,
  variable: ImageVariable,
  indices: number[],
  mode: "rgb" | "scalar" = "scalar",
  spatialRegion?: SpatialRegionSelection,
): Promise<LoadedPlaneChunk> {
  const expectedShape = expectedPlaneShape(variable, indices, mode, spatialRegion);
  const selection = buildZarrSelection(variable, indices, mode, spatialRegion);

  const chunk = await zarr.get(arr, selection);
  const shape = [...chunk.shape];
  if (shapesEqual(shape, expectedShape)) {
    const logical = materializeChunk(
      chunk.data as ArrayLike<number>,
      shape,
      [...chunk.stride],
    );
    return { data: logical, shape, stride: [...chunk.stride] };
  }

  return loadPlaneByTiles(arr, variable, indices, mode, expectedShape, spatialRegion);
}
