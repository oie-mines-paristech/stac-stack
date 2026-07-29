import type * as zarr from "zarrita";
import type { ImageVariable } from "./dimensions.js";
import { axisByRole } from "./dimensions.js";
import { loadImagePlane, type ImagePlane } from "./render.js";

export function planeCacheKey(
  variablePath: string,
  mode: "rgb" | "scalar",
  selection: Record<string, number>,
  timeAxisName: string | null,
  timeIndex: number | null,
): string {
  const parts = [variablePath, mode];
  for (const [name, value] of Object.entries(selection).sort(([a], [b]) => a.localeCompare(b))) {
    if (name === timeAxisName) continue;
    parts.push(`${name}=${value}`);
  }
  if (timeAxisName !== null && timeIndex !== null) {
    parts.push(`${timeAxisName}=${timeIndex}`);
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
  isCurrentGeneration: () => boolean;
}

let prefetchGeneration = 0;

export function cancelPrefetch(): void {
  prefetchGeneration++;
}

export async function prefetchDayPlanes(ctx: PrefetchContext): Promise<void> {
  const runId = ++prefetchGeneration;
  const concurrency = 6;
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
  selection: Record<string, number>,
  mode: "rgb" | "scalar",
): Promise<{ plane: ImagePlane; timings: FrameTimings }> {
  const timeAxis = axisByRole(variable, "time");
  const timeIndex = timeAxis ? selection[timeAxis.name] ?? null : null;
  const key = planeCacheKey(
    variable.path,
    mode,
    selection,
    timeAxis?.name ?? null,
    timeIndex,
  );

  const started = performance.now();
  const cached = cache.get(key);
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

  const fetchStart = performance.now();
  const indices = variable.axes.map((axis) => selection[axis.name] ?? 0);
  const plane = await loadImagePlane(arr, variable, indices, mode);
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
}
