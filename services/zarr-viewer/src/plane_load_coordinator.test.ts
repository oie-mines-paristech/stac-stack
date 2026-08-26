import {
  loadImagePlaneCoordinated,
  resetPlaneLoadCoordinatorForTests,
  runChunkPrefetch,
} from "./plane_load_coordinator.js";
import { groupTimeIndicesByImageChunk } from "./chunk_plan.js";
import type { ImageVariable } from "./dimensions.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function hdrVariable(): ImageVariable {
  return {
    path: "hdr_image",
    shape: [236, 850, 884, 3],
    chunkShape: [24, 850, 884, 3],
    dtype: "uint8",
    dimensionNames: ["time", "sensor_y", "sensor_x", "rgb"],
    axes: [
      { name: "time", role: "time", size: 236, index: 0 },
      { name: "sensor_y", role: "y", size: 850, index: 1 },
      { name: "sensor_x", role: "x", size: 884, index: 2 },
      { name: "rgb", role: "band", size: 3, index: 3 },
    ],
    attributes: {},
  };
}

const variable = hdrVariable();
const selection = {};
const dayIndices = Array.from({ length: 68 }, (_, i) => i + 100);
const groups = groupTimeIndicesByImageChunk(variable, "rgb", selection, "time", dayIndices);
assert(groups.size === 3, `68 steps in 3 time chunks, got ${groups.size}`);
for (const indices of groups.values()) {
  assert(indices.length <= 24, "at most 24 frames per time chunk");
}

let chunkRuns = 0;
resetPlaneLoadCoordinatorForTests();
await Promise.all([
  runChunkPrefetch("0,0,0,0", async () => {
    chunkRuns++;
    await new Promise((r) => setTimeout(r, 50));
  }),
  runChunkPrefetch("0,0,0,0", async () => {
    chunkRuns++;
  }),
]);
assert(chunkRuns === 1, "chunk prefetch dedupes in-flight work");

let planeLoads = 0;
resetPlaneLoadCoordinatorForTests();
const p1 = loadImagePlaneCoordinated("k", "prefetch", async () => {
  planeLoads++;
  await new Promise((r) => setTimeout(r, 10));
  return { data: new Uint8Array(1), shape: [1, 1], axes: { time: -1, band: -1, y: 0, x: 1 } };
});
const p2 = loadImagePlaneCoordinated("k", "prefetch", async () => {
  planeLoads++;
  return { data: new Uint8Array(1), shape: [1, 1], axes: { time: -1, band: -1, y: 0, x: 1 } };
});
await Promise.all([p1, p2]);
assert(planeLoads === 1, "plane load dedupes concurrent requests");

console.log("plane_load_coordinator.test.ts: ok");
