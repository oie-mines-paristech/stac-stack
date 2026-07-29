import type { ByteCache } from "zarrita";
import { formatBytes } from "./chunk_plan.js";

export const CHUNK_FETCH_CONCURRENCY = 4;

export interface ChunkLoadSession {
  label: string;
  expectedChunks: number;
  expectedBytes: number;
  expectedNetworkBytes: number;
}

export interface ChunkProgressSnapshot {
  active: boolean;
  label: string;
  completed: number;
  total: number;
  receivedBytes: number;
  expectedNetworkBytes: number;
}

let currentSession: ChunkLoadSession | null = null;
const completedKeys = new Set<string>();
let receivedBytes = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeChunkProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChunkProgress(): ChunkProgressSnapshot {
  return {
    active: currentSession !== null,
    label: currentSession?.label ?? "",
    completed: completedKeys.size,
    total: currentSession?.expectedChunks ?? 0,
    receivedBytes,
    expectedNetworkBytes: currentSession?.expectedNetworkBytes ?? 0,
  };
}

export function beginChunkLoad(session: ChunkLoadSession): void {
  currentSession = session;
  completedKeys.clear();
  receivedBytes = 0;
  notify();
}

export function endChunkLoad(): void {
  currentSession = null;
  completedKeys.clear();
  receivedBytes = 0;
  notify();
}

export function normalizeChunkProgressKey(key: string): string {
  try {
    if (/^https?:\/\//i.test(key)) {
      return new URL(key).pathname;
    }
  } catch {
    // fall through
  }
  return key;
}

export function recordChunkKey(key: string, bytes = 0): void {
  if (!currentSession) return;
  const normalized = normalizeChunkProgressKey(key);
  if (completedKeys.has(normalized)) return;
  completedKeys.add(normalized);
  if (bytes > 0) receivedBytes += bytes;
  notify();
}

export function isZarrChunkUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return /\/c\/\d+/.test(path) || /\/chunks?\//.test(path);
  } catch {
    return /\/c\/\d+/.test(url);
  }
}

class FetchSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const fetchSemaphore = new FetchSemaphore(CHUNK_FETCH_CONCURRENCY);

export function wrapFetchWithConcurrency(fetchFn: typeof fetch): typeof fetch {
  return async (input, init) => {
    const release = await fetchSemaphore.acquire();
    try {
      const response = await fetchFn(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (currentSession && isZarrChunkUrl(url)) {
        const length = Number(response.headers.get("content-length"));
        recordChunkKey(url, Number.isFinite(length) && length > 0 ? length : 0);
      }
      return response;
    } finally {
      release();
    }
  };
}

export function createInstrumentedByteCache(base: Map<string, Uint8Array | undefined>): ByteCache {
  return {
    has(key: string): boolean {
      return base.has(key);
    },
    get(key: string): Uint8Array | undefined {
      const value = base.get(key);
      if (value !== undefined) {
        recordChunkKey(key, value.byteLength);
      }
      return value;
    },
    set(key: string, value: Uint8Array | undefined): void {
      base.set(key, value);
      if (value !== undefined) {
        recordChunkKey(key, value.byteLength);
      }
    },
  };
}

export function formatChunkProgressLine(snapshot: ChunkProgressSnapshot, prefix = "Loading…"): string {
  if (!snapshot.active || snapshot.total <= 0) return prefix;
  const bytesPart =
    snapshot.receivedBytes > 0 || snapshot.expectedNetworkBytes > 0
      ? ` · ${formatBytes(Math.max(snapshot.receivedBytes, 0))}`
      : "";
  return `${prefix} ${snapshot.completed}/${snapshot.total} chunks${bytesPart}`;
}
