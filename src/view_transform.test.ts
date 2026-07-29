import {
  canvasToPlanePixel,
  clampViewOrigin,
  computeViewLayout,
} from "./view_transform.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const fillLayout = computeViewLayout(8192, 4096, 1200, 800, true, { x: 0, y: 0 });
assert(fillLayout.region.width === 8192, "fill region width");
assert(fillLayout.target.width === 1200, "fill target width");
assert(fillLayout.target.height === 600, "fill target height");

const visible = computeViewLayout(8192, 4096, 1200, 800, false, { x: 500, y: 200 });
assert(visible.region.x0 === 500 && visible.region.y0 === 200, "visible origin");
assert(visible.region.width === 1200 && visible.region.height === 800, "visible region size");

const clamped = clampViewOrigin({ x: 9000, y: 9000 }, 8192, 4096, 1200, 800);
assert(clamped.x === 6992 && clamped.y === 3296, "clamp view origin");

const mapped = canvasToPlanePixel(10, 20, visible.displayTransform, false);
assert(mapped.x === 510, "canvasToPlanePixel x with offset");
assert(mapped.y === 220, "canvasToPlanePixel y with offset");

console.log("view_transform.test.ts: ok");
