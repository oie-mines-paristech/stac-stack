/**
 * Vite worker entry for the JPEG-XL decode pool.
 * Bundled separately so WASM + libjxl run off the main thread.
 */
import { decodeWithModule } from "@oie-minesparis-psl/jpegxl-zarr/decode-core";
import type { JpegxlConfig } from "@oie-minesparis-psl/jpegxl-zarr/types";
import { loadWasmModule } from "@oie-minesparis-psl/jpegxl-zarr/wasm-loader";

interface DecodeJob {
  id: number;
  type: "decode";
  buf: ArrayBuffer;
  configJson: string;
}

interface WorkerResult {
  id: number;
  type: "result";
  data: ArrayBuffer;
  dtype: string;
  shape: number[];
  planar: boolean;
}

interface WorkerError {
  id: number;
  type: "error";
  message: string;
}

const moduleReady = loadWasmModule();

self.onmessage = (event: MessageEvent<DecodeJob>) => {
  const job = event.data;
  if (job.type !== "decode") return;

  void (async () => {
    try {
      const mod = await moduleReady;
      const config = JSON.parse(job.configJson) as JpegxlConfig;
      const image = decodeWithModule(mod, new Uint8Array(job.buf), config);
      const result: WorkerResult = {
        id: job.id,
        type: "result",
        data: image.data,
        dtype: image.dtype,
        shape: image.shape,
        planar: image.planar,
      };
      (self as unknown as Worker).postMessage(result, [image.data]);
    } catch (error) {
      const message: WorkerError = {
        id: job.id,
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(message);
    }
  })();
};
