import { renderRgbRegionToRgba, renderScalarRegionToRgba } from "./render_core.js";

export interface WorkerScalarRequest {
  id: number;
  kind: "scalar";
  buffer: ArrayBuffer;
  planeWidth: number;
  planeHeight: number;
  shape: number[];
  axes: { x: number; y: number; band: number };
  region: { x0: number; y0: number; width: number; height: number };
  target: { width: number; height: number };
  min: number;
  max: number;
  lut: Uint8Array;
  flipY: boolean;
  dtype: "float32" | "float64";
}

export interface WorkerRgbRequest {
  id: number;
  kind: "rgb";
  buffer: ArrayBuffer;
  planeWidth: number;
  planeHeight: number;
  shape: number[];
  axes: { x: number; y: number; band: number };
  region: { x0: number; y0: number; width: number; height: number };
  target: { width: number; height: number };
  bandIndices: [number, number, number];
  ranges: Array<[number, number]>;
  flipY: boolean;
  dtype: "float32" | "float64";
}

export type WorkerRenderRequest = WorkerScalarRequest | WorkerRgbRequest;

export interface WorkerRenderResponse {
  id: number;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

function planeDataFromBuffer(buffer: ArrayBuffer, dtype: "float32" | "float64"): Float32Array | Float64Array {
  return dtype === "float32"
    ? new Float32Array(buffer)
    : new Float64Array(buffer);
}

self.onmessage = (event: MessageEvent<WorkerRenderRequest>) => {
  const request = event.data;
  const data = planeDataFromBuffer(request.buffer, request.dtype);
  const region = request.region;
  const target = request.target;

  const rgba =
    request.kind === "scalar"
      ? renderScalarRegionToRgba({
          data,
          planeWidth: request.planeWidth,
          planeHeight: request.planeHeight,
          shape: request.shape,
          axes: request.axes,
          region,
          target,
          min: request.min,
          max: request.max,
          lut: request.lut,
          flipY: request.flipY,
        })
      : renderRgbRegionToRgba({
          data,
          planeWidth: request.planeWidth,
          planeHeight: request.planeHeight,
          shape: request.shape,
          axes: request.axes,
          region,
          target,
          bandIndices: request.bandIndices,
          ranges: request.ranges,
          flipY: request.flipY,
        });

  const response: WorkerRenderResponse = {
    id: request.id,
    rgba,
    width: target.width,
    height: target.height,
  };
  self.postMessage(response, { transfer: [rgba.buffer] });
};

export {};
