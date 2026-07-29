import type * as zarr from "zarrita";
import {
  isSpatiallyMultiChunk,
  planLoadOperation,
  planPlaneChunks,
  planSingleSpatialTile,
  spatialChunkGrid,
  shouldWarnChunkPlan,
  type LoadOperationPlan,
} from "./chunk_plan.js";
import { beginChunkLoad, endChunkLoad } from "./chunk_progress.js";
import type { DatasetSchema, ImageVariable } from "./dimensions.js";
import { axisByRole } from "./dimensions.js";
import { loadImagePlane, type ImagePlane } from "./render.js";
import { getCachedCoordinateValues } from "./store.js";
import {
  promptChunkLoadChoice,
} from "./ui/chunk_confirm_dialog.js";

export class ChunkLoadCancelledError extends Error {
  constructor() {
    super("Load cancelled");
    this.name = "ChunkLoadCancelledError";
  }
}

export interface SpatialTilePick {
  yChunk: number;
  xChunk: number;
}

export interface LoadPlaneOptions {
  spatialTile: SpatialTilePick | null;
  setSpatialTile: (tile: SpatialTilePick | null) => void;
}

export function planeCacheKey(
  variablePath: string,
  mode: "rgb" | "scalar",
  selection: Record<string, number>,
  timeAxisName: string | null,
  timeIndex: number | null,
  spatialTile?: SpatialTilePick | null,
): string {
  const parts = [variablePath, mode];
  for (const [name, value] of Object.entries(selection).sort(([a], [b]) => a.localeCompare(b))) {
    if (name === timeAxisName) continue;
    parts.push(`${name}=${value}`);
  }
  if (timeAxisName !== null && timeIndex !== null) {
    parts.push(`${timeAxisName}=${timeIndex}`);
  }
  if (spatialTile) {
    parts.push(`tile=${spatialTile.yChunk},${spatialTile.xChunk}`);
  }
  return parts.join("|");
}

export class LruPlaneCache {
  private readonly map = new Map<string, ImagePlane>();

  constructor(private readonly maxSize = 128) {}

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): ImagePlane | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, plane: ImagePlane): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, plane);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export interface PrefetchContext {
  arr: zarr.Array<zarr.DataType>;
  variable: ImageVariable;
  mode: "rgb" | "scalar";
  selection: Record<string, number>;
  timeAxisName: string;
  timeIndices: number[];
  cache: LruPlaneCache;
  generation: number;
  spatialTile: SpatialTilePick | null;
  isCurrentGeneration: () => boolean;
}

let prefetchGeneration = 0;

export function cancelPrefetch(): void {
  prefetchGeneration++;
}

function cachedCoordPathsForVariable(variable: ImageVariable): Set<string> {
  const cached = new Set<string>();
  for (const axis of variable.axes) {
    const path = axis.coordinate?.path;
    if (path && getCachedCoordinateValues(path) !== undefined) {
      cached.add(path);
    }
  }
  return cached;
}

async function resolveChunkLoadChoice(
  loadPlan: LoadOperationPlan,
  variable: ImageVariable,
  variablePath: string,
  spatialTile: SpatialTilePick | null,
): Promise<{ spatialTile: SpatialTilePick | null }> {
  if (spatialTile || !shouldWarnChunkPlan(loadPlan)) {
    return { spatialTile };
  }

  const grid = spatialChunkGrid(variable);
  const choice = await promptChunkLoadChoice(loadPlan, grid, variablePath);

  if (choice.action === "dismiss") {
    throw new ChunkLoadCancelledError();
  }
  if (choice.action === "single") {
    return { spatialTile: { yChunk: choice.yChunk, xChunk: choice.xChunk } };
  }
  if (choice.action === "full" || choice.action === "proceed") {
    if (grid && isSpatiallyMultiChunk(grid)) {
      throw new ChunkLoadCancelledError();
    }
    return { spatialTile: null };
  }

  throw new ChunkLoadCancelledError();
}

export async function prefetchDayPlanes(ctx: PrefetchContext): Promise<void> {
  if (ctx.spatialTile) return;

  const runId = ++prefetchGeneration;
  const concurrency = 4;
  const queue = [...ctx.timeIndices];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      if (runId !== prefetchGeneration || !ctx.isCurrentGeneration()) return;
      const timeIndex = queue.shift();
      if (timeIndex === undefined) return;

      const key = planeCacheKey(
        ctx.variable.path,
        ctx.mode,
        { ...ctx.selection, [ctx.timeAxisName]: timeIndex },
        ctx.timeAxisName,
        timeIndex,
        null,
      );
      if (ctx.cache.has(key)) continue;

      const indices = ctx.variable.axes.map((axis) => {
        if (axis.name === ctx.timeAxisName) return timeIndex;
        return ctx.selection[axis.name] ?? 0;
      });

      try {
        const plane = await loadImagePlane(ctx.arr, ctx.variable, indices, ctx.mode);
        if (runId !== prefetchGeneration || !ctx.isCurrentGeneration()) return;
        ctx.cache.set(key, plane);
      } catch {
        // Skip failed prefetch frames; interactive load will surface errors.
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

export interface FrameTimings {
  cacheHit: boolean;
  fetchMs: number;
  renderMs: number;
  totalMs: number;
}

export async function loadPlaneWithCache(
  cache: LruPlaneCache,
  arr: zarr.Array<zarr.DataType>,
  variable: ImageVariable,
  schema: DatasetSchema,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
  options: LoadPlaneOptions,
): Promise<{ plane: ImagePlane; timings: FrameTimings }> {
  const timeAxis = axisByRole(variable, "time");
  const timeIndex = timeAxis ? selection[timeAxis.name] ?? null : null;
  let spatialTile = options.spatialTile;

  const cacheKey = (tile: SpatialTilePick | null) =>
    planeCacheKey(
      variable.path,
      mode,
      selection,
      timeAxis?.name ?? null,
      timeIndex,
      tile,
    );

  const started = performance.now();
  let key = cacheKey(spatialTile);
  let cached = cache.get(key);
  if (cached) {
    return {
      plane: cached,
      timings: {
        cacheHit: true,
        fetchMs: 0,
        renderMs: 0,
        totalMs: performance.now() - started,
      },
    };
  }

  const fullPlan = planLoadOperation({
    variable,
    selection,
    mode,
    schema,
    cachedCoordPaths: cachedCoordPathsForVariable(variable),
  });

  const resolved = await resolveChunkLoadChoice(
    fullPlan,
    variable,
    variable.path,
    spatialTile,
  );
  if (resolved.spatialTile !== spatialTile) {
    spatialTile = resolved.spatialTile;
    options.setSpatialTile(spatialTile);
    key = cacheKey(spatialTile);
    cached = cache.get(key);
    if (cached) {
      return {
        plane: cached,
        timings: {
          cacheHit: true,
          fetchMs: 0,
          renderMs: 0,
          totalMs: performance.now() - started,
        },
      };
    }
  }

  const loadPlan = spatialTile
    ? planSingleSpatialTile(variable, spatialTile.yChunk, spatialTile.xChunk)
    : fullPlan;

  beginChunkLoad({
    label: "frame",
    expectedChunks: loadPlan.imageChunks,
    expectedBytes: loadPlan.logicalBytes,
    expectedNetworkBytes: loadPlan.imageNetworkBytes,
  });

  const fetchStart = performance.now();
  try {
    const indices = variable.axes.map((axis) => selection[axis.name] ?? 0);
    const plane = await loadImagePlane(arr, variable, indices, mode, spatialTile ?? undefined);
    const fetchMs = performance.now() - fetchStart;
    cache.set(key, plane);

    return {
      plane,
      timings: {
        cacheHit: false,
        fetchMs,
        renderMs: 0,
        totalMs: performance.now() - started,
      },
    };
  } finally {
    endChunkLoad();
  }
}

/** @internal exported for tests */
export function buildLoadPlanForFrame(
  variable: ImageVariable,
  schema: DatasetSchema,
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): LoadOperationPlan {
  return planLoadOperation({
    variable,
    selection,
    mode,
    schema,
    cachedCoordPaths: cachedCoordPathsForVariable(variable),
  });
}

/** @internal exported for tests */
export { planPlaneChunks };
