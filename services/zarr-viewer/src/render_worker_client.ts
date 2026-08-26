import type { PlaneData, PlaneDtypeTag } from "./chunk_utils.js";
import type { WorkerRenderRequest, WorkerRenderResponse } from "./render_worker.js";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: WorkerRenderResponse) => void; reject: (error: Error) => void }
>();

function ensureWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./render_worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerRenderResponse>) => {
      const response = event.data;
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      entry.resolve(response);
    };
    worker.onerror = (error) => {
      for (const [, entry] of pending) {
        entry.reject(error instanceof ErrorEvent ? new Error(error.message) : new Error("Worker error"));
      }
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function renderWorkerAvailable(): boolean {
  return ensureWorker() !== null;
}

export function planeDtype(data: PlaneData): PlaneDtypeTag {
  if (data instanceof Float32Array) return "float32";
  if (data instanceof Uint8Array) return "uint8";
  if (data instanceof Int8Array) return "int8";
  if (data instanceof Uint16Array) return "uint16";
  if (data instanceof Int16Array) return "int16";
  if (data instanceof Uint32Array) return "uint32";
  if (data instanceof Int32Array) return "int32";
  return "float64";
}

export async function renderInWorker(request: WorkerRenderRequest): Promise<WorkerRenderResponse> {
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    throw new Error("Render worker unavailable");
  }
  const id = nextId++;
  const payload = { ...request, id };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    activeWorker.postMessage(payload, [payload.buffer]);
  });
}

export function terminateRenderWorker(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}
