import {
  buildZarrSelection,
  expectedPlaneShape,
  shapeProduct,
  shapesEqual,
} from "./array_load.js";
import { spatialChunkGrid, tileIndexRanges } from "./chunk_plan.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(shapeProduct([4096, 8193]) === 4096 * 8193, "shape product");
assert(shapesEqual([512, 512], [512, 512]), "shapes equal");
assert(!shapesEqual([512, 512], [4096, 8193]), "shapes differ");

const variable = {
  path: "t2m",
  shape: [306816, 4096, 8193],
  chunkShape: [24, 512, 512],
  dtype: "float32",
  dimensionNames: ["time", "latitude", "longitude"],
  axes: [
    { name: "time", role: "time" as const, size: 306816, index: 0 },
    { name: "latitude", role: "y" as const, size: 4096, index: 1 },
    { name: "longitude", role: "x" as const, size: 8193, index: 2 },
  ],
  attributes: {},
};

const expected = expectedPlaneShape(variable, [100, 0, 0], "scalar");
assert(
  shapesEqual(expected, [4096, 8193]),
  `expected plane shape [4096,8193], got [${expected.join(",")}]`,
);

const grid = spatialChunkGrid(variable);
assert(grid !== null, "spatial grid for EDH-like variable");
const tileSelection = { yChunk: 2, xChunk: 3, grid: grid! };
const tileShape = expectedPlaneShape(variable, [100, 0, 0], "scalar", tileSelection);
assert(
  shapesEqual(tileShape, [512, 512]),
  `tile plane shape [512,512], got [${tileShape.join(",")}]`,
);

const selection = buildZarrSelection(variable, [100, 0, 0], "scalar", tileSelection);
const ranges = tileIndexRanges(grid!, 2, 3);
assert(selection[0] === 100, "time index fixed");
assert(
  typeof selection[1] === "object" &&
    "start" in selection[1]! &&
    selection[1].start === ranges.y[0] &&
    selection[1].stop === ranges.y[1],
  "y axis bounded slice",
);
assert(
  typeof selection[2] === "object" &&
    "start" in selection[2]! &&
    selection[2].start === ranges.x[0] &&
    selection[2].stop === ranges.x[1],
  "x axis bounded slice",
);

console.log("array_load.test.ts: ok");
