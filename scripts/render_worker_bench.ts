import { performance } from "node:perf_hooks";
import { getColormapLut } from "../src/colormap.js";
import { renderScalarRegionToRgba } from "../src/render_core.js";

interface BenchPayload {
  planeWidth: number;
  planeHeight: number;
  regionWidth: number;
  regionHeight: number;
}

const payload = JSON.parse(process.argv[2] ?? "{}") as BenchPayload;
const length = payload.planeWidth * payload.planeHeight;
const data = new Float64Array(length);
for (let i = 0; i < length; i++) {
  data[i] = Math.sin(i * 0.001) * 100;
}

const t0 = performance.now();
renderScalarRegionToRgba({
  data,
  planeWidth: payload.planeWidth,
  planeHeight: payload.planeHeight,
  shape: [payload.planeHeight, payload.planeWidth],
  axes: { x: 1, y: 0, band: -1 },
  region: { x0: 0, y0: 0, width: payload.regionWidth, height: payload.regionHeight },
  target: { width: payload.regionWidth, height: payload.regionHeight },
  min: -100,
  max: 100,
  lut: getColormapLut("viridis"),
  flipY: false,
});
process.stdout.write(String(performance.now() - t0));
