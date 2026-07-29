import { arrayMinMax } from "./scaling.js";
import {
  canvasToPlanePixel,
  computeDisplaySize,
  renderImageToCanvas,
} from "./render.js";
import { computeViewLayout } from "./view_transform.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const data = new Float32Array([1, 2, 3, 4, 5, 6]);
assert(arrayMinMax(data)[0] === 1 && arrayMinMax(data)[1] === 6, "arrayMinMax on Float32Array");

const display = computeDisplaySize(8192, 4096, 1200, 800, true);
assert(display?.width === 1200 && display?.height === 600, "computeDisplaySize fit");

const visibleLayout = computeViewLayout(8192, 4096, 1200, 800, false, { x: 100, y: 50 });
assert(visibleLayout.region.x0 === 100, "visible region x0");
assert(visibleLayout.region.y0 === 50, "visible region y0");
assert(visibleLayout.target.width === 1200, "visible target width");
assert(visibleLayout.target.height === 800, "visible target height");

const plane = {
  data: new Float32Array([0, 50, 100, 150]),
  shape: [2, 2],
  axes: { time: -1, band: -1, y: 0, x: 1 },
};

let imageData: ImageData | null = null;
const canvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    createImageData(w: number, h: number) {
      imageData = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData;
      return imageData;
    },
    putImageData(d: ImageData) {
      imageData = d;
    },
  }),
} as unknown as HTMLCanvasElement;

const result = renderImageToCanvas(
  canvas,
  plane,
  {
    mode: "scalar",
    rgbBands: [0, 1, 2],
    autoscale: true,
    attributes: {},
    flipY: false,
    colormap: "viridis",
  },
  { viewportWidth: 1, viewportHeight: 1, fillView: true },
);

assert(canvas.width === 1 && canvas.height === 1, "render respects displaySize");
assert(result.displayTransform.canvasWidth === 1, "displayTransform set");

const mapped = canvasToPlanePixel(0, 0, result.displayTransform, false);
assert(mapped.x === 0 && mapped.y === 0, "canvasToPlanePixel origin");

console.log("render.test.ts: ok");
