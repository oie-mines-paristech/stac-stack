import type { ImagePlane } from "./render.js";

export type PlaneLoadPriority = "interactive" | "prefetch";

const inFlight = new Map<string, Promise<ImagePlane>>();
const chunkInFlight = new Map<string, Promise<void>>();
let interactiveLoads = 0;

export function beginInteractivePlaneLoad(): void {
  interactiveLoads++;
}

export function endInteractivePlaneLoad(): void {
  interactiveLoads = Math.max(0, interactiveLoads - 1);
}

export function interactivePlaneLoadsActive(): boolean {
  return interactiveLoads > 0;
}

async function waitForInteractiveIdle(): Promise<void> {
  while (interactiveLoads > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, 16));
  }
}

export async function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Dedupe concurrent plane loads by cache key; prefetch waits for interactive loads. */
export async function loadImagePlaneCoordinated(
  cacheKey: string,
  priority: PlaneLoadPriority,
  load: () => Promise<ImagePlane>,
): Promise<ImagePlane> {
  if (priority === "interactive") {
    beginInteractivePlaneLoad();
  } else {
    await waitForInteractiveIdle();
  }

  try {
    const existing = inFlight.get(cacheKey);
    if (existing) return existing;

    const promise = load().finally(() => {
      if (inFlight.get(cacheKey) === promise) {
        inFlight.delete(cacheKey);
      }
    });
    inFlight.set(cacheKey, promise);
    return promise;
  } finally {
    if (priority === "interactive") {
      endInteractivePlaneLoad();
    }
  }
}

/** Serialize prefetch work per image chunk key (one shard decode chain at a time). */
export async function runChunkPrefetch(
  chunkKey: string,
  work: () => Promise<void>,
): Promise<void> {
  const existing = chunkInFlight.get(chunkKey);
  if (existing) {
    await existing;
    return;
  }

  const promise = work().finally(() => {
    if (chunkInFlight.get(chunkKey) === promise) {
      chunkInFlight.delete(chunkKey);
    }
  });
  chunkInFlight.set(chunkKey, promise);
  await promise;
}

/** @internal test helper */
export function resetPlaneLoadCoordinatorForTests(): void {
  inFlight.clear();
  chunkInFlight.clear();
  interactiveLoads = 0;
}
