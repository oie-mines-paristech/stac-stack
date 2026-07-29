import * as zarr from "zarrita";
import { materializeChunk } from "./chunk_utils.js";
import { tileIndexRanges, type SpatialChunkGrid } from "./chunk_plan.js";
import type { ImageVariable } from "./dimensions.js";

export interface SpatialTileSelection {
  yChunk: number;
  xChunk: number;
  grid: SpatialChunkGrid;
}

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

export function buildZarrSelection(
  variable: ImageVariable,
  indices: number[],
  mode: "rgb" | "scalar",
  spatialTile?: SpatialTileSelection,
): ZarrSelection {
  const tileRanges = spatialTile
    ? tileIndexRanges(spatialTile.grid, spatialTile.yChunk, spatialTile.xChunk)
    : null;

  return variable.axes.map((axis, dim) => {
    if (tileRanges && axis.role === "y" && dim === spatialTile!.grid.yAxisIndex) {
      return zarr.slice(tileRanges.y[0], tileRanges.y[1]);
    }
    if (tileRanges && axis.role === "x" && dim === spatialTile!.grid.xAxisIndex) {
      return zarr.slice(tileRanges.x[0], tileRanges.x[1]);
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
  spatialTile?: SpatialTileSelection,
): number[] {
  const tileRanges = spatialTile
    ? tileIndexRanges(spatialTile.grid, spatialTile.yChunk, spatialTile.xChunk)
    : null;
  const shape: number[] = [];
  for (const axis of variable.axes) {
    if (axis.role === "x" || axis.role === "y") {
      if (tileRanges) {
        const range = axis.role === "y" ? tileRanges.y : tileRanges.x;
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
): Promise<LoadedPlaneChunk> {
  const chunkShape = variable.chunkShape;
  if (!chunkShape || chunkShape.length !== variable.shape.length) {
    throw new Error("Cannot assemble plane without chunk_shape metadata");
  }
  const gridChunkShape = chunkShape;

  const selection = buildZarrSelection(variable, indices, mode);
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

  const tileCounts = planeVarDims.map((dim) => {
    const size = variable.shape[dim];
    const cs = gridChunkShape[dim] ?? size;
    return Math.max(1, Math.ceil(size / cs));
  });

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
        return coord * cs;
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
      await walkPlaneDim(planeAxis + 1, [...coords, c]);
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
  spatialTile?: SpatialTileSelection,
): Promise<LoadedPlaneChunk> {
  const expectedShape = expectedPlaneShape(variable, indices, mode, spatialTile);
  const selection = buildZarrSelection(variable, indices, mode, spatialTile);

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

  if (spatialTile) {
    throw new Error(
      `Spatial tile load shape mismatch: expected [${expectedShape.join(", ")}], got [${shape.join(", ")}]`,
    );
  }

  return loadPlaneByTiles(arr, variable, indices, mode, expectedShape);
}
