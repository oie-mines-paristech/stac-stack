import { formatHoverLine, type SpatialCoords } from "./hover.js";
import type { ImagePlane } from "./render.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const plane: ImagePlane = {
  shape: [2, 2],
  axes: { x: 1, y: 0, band: -1, time: -1 },
  data: new Float32Array([1, 2, 3, 4]),
};

const spatial: SpatialCoords = {
  xName: "longitude",
  yName: "latitude",
  xValues: [0, 1],
  yValues: [10, 20],
  flipY: false,
};

const line = formatHoverLine(plane, 1, 0, spatial, undefined, "K");
assert(line.includes("lon:1"), "longitude abbreviated to lon");
assert(line.includes("lat:10"), "latitude abbreviated to lat");
assert(line.includes("val:"), "value abbreviated to val");
assert(!line.includes("idx"), "no pixel index in hover line");
assert(!line.includes("longitude"), "no full longitude label");
assert(!line.includes("value:"), "no full value label");

const gridSpatial: SpatialCoords = {
  xName: "x",
  yName: "y",
  xValues: [100, 200],
  yValues: [10, 20],
  flipY: false,
};
const gridLine = formatHoverLine(plane, 1, 0, gridSpatial, undefined, "K");
assert(gridLine.includes("x:1"), "non-lat-lon uses x index");
assert(gridLine.includes("y:0"), "non-lat-lon uses y index");
assert(!gridLine.includes("200"), "non-lat-lon skips coordinate values");

console.log("hover.test.ts: ok");
