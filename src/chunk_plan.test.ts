import {
  chunkPickerSpatialMessage,
  chunkPlanConfirmMessage,
  formatChunkEstimate,
  formatRegionLoadEstimate,
  isSpatiallyMultiChunk,
  networkBytesPerImageChunk,
  planDayChunks,
  planLoadOperation,
  planPlaneChunks,
  planSingleSpatialTile,
  planSpatialRegion,
  regionIndexRanges,
  shouldWarnChunkPlan,
  spatialChunkGrid,
  tileIndexRanges,
  WARN_CHUNK_COUNT,
  WARN_LOGICAL_BYTES,
} from "./chunk_plan.js";
import type { ImageVariable } from "./dimensions.js";
import type { DatasetSchema } from "./dimensions.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function edhVariable(): ImageVariable {
  return {
    path: "t2m",
    shape: [306816, 4096, 8193],
    chunkShape: [24, 512, 512],
    dtype: "float32",
    dimensionNames: ["time", "latitude", "longitude"],
    axes: [
      { name: "time", role: "time", size: 306816, index: 0 },
      { name: "latitude", role: "y", size: 4096, index: 1 },
      { name: "longitude", role: "x", size: 8193, index: 2 },
    ],
    attributes: {},
  };
}

function edhSchema(): DatasetSchema {
  return {
    url: "https://example.com/data.zarr/",
    rootAttributes: {},
    coordinates: {
      time: { path: "time", dimensionNames: ["time"], attributes: {}, shape: [306816], chunkShape: [306816], dtype: "int64" },
      latitude: { path: "latitude", dimensionNames: ["latitude"], attributes: {}, shape: [4096], chunkShape: [4096], dtype: "float64" },
      longitude: { path: "longitude", dimensionNames: ["longitude"], attributes: {}, shape: [8193], chunkShape: [8193], dtype: "float64" },
    },
    variables: [],
  };
}

function sophiaVariable(): ImageVariable {
  return {
    path: "data",
    shape: [100, 512, 512],
    chunkShape: [1, 256, 256],
    dtype: "float32",
    dimensionNames: ["time", "y", "x"],
    axes: [
      { name: "time", role: "time", size: 100, index: 0 },
      { name: "y", role: "y", size: 512, index: 1 },
      { name: "x", role: "x", size: 512, index: 2 },
    ],
    attributes: {},
  };
}

const edh = edhVariable();
const edhSelection = { time: 100, latitude: 0, longitude: 0 };
const edhPlan = planPlaneChunks(edh, edhSelection, "scalar");
assert(edhPlan.chunkCount === 136, `EDH frame: 136 chunks, got ${edhPlan.chunkCount}`);
assert(
  edhPlan.logicalBytes === 4096 * 8193 * 4,
  `EDH frame logical bytes, got ${edhPlan.logicalBytes}`,
);
const perChunk = networkBytesPerImageChunk(edh);
assert(perChunk === 24 * 512 * 512 * 4, `EDH network bytes per chunk, got ${perChunk}`);
assert(
  edhPlan.networkBytes === 136 * perChunk,
  `EDH frame network bytes, got ${edhPlan.networkBytes}`,
);
assert(edhPlan.networkBytes > edhPlan.logicalBytes * 20, "network bytes >> logical frame bytes");
assert(shouldWarnChunkPlan(edhPlan), "EDH frame triggers warning");

function edhVariableWithCoords(schema: DatasetSchema): ImageVariable {
  const base = edhVariable();
  return {
    ...base,
    axes: base.axes.map((axis) => ({
      ...axis,
      coordinate: schema.coordinates[axis.name],
    })),
  };
}

const schema = edhSchema();
const edhWithCoords = edhVariableWithCoords(schema);
const loadPlan = planLoadOperation({
  variable: edhWithCoords,
  selection: edhSelection,
  mode: "scalar",
  schema,
});
assert(loadPlan.imageChunks === 136, "load plan image chunks");
assert(loadPlan.coordChunks === 3, "load plan includes 3 coord arrays");
assert(
  chunkPlanConfirmMessage(loadPlan).includes("136 chunks"),
  "confirm message mentions image chunks",
);
assert(
  chunkPlanConfirmMessage(loadPlan).includes("on wire"),
  "confirm message mentions wire volume",
);

const dayIndices = Array.from({ length: 24 }, (_, i) => i);
const dayPlan = planDayChunks(edh, edhSelection, "time", dayIndices, "scalar");
assert(dayPlan.chunkCount === 136, `EDH day union: 136, got ${dayPlan.chunkCount}`);

const spanIndices = Array.from({ length: 24 }, (_, i) => 20 + i);
const spanPlan = planDayChunks(edh, edhSelection, "time", spanIndices, "scalar");
assert(spanPlan.chunkCount === 272, `EDH day spanning 2 time chunks: 272, got ${spanPlan.chunkCount}`);

const sophia = sophiaVariable();
const sophiaPlan = planPlaneChunks(sophia, { time: 0, y: 0, x: 0 }, "scalar");
assert(sophiaPlan.chunkCount === 4, `Sophia-like frame: 4 chunks, got ${sophiaPlan.chunkCount}`);
assert(!shouldWarnChunkPlan(sophiaPlan), "Sophia-like frame does not warn");

const lightPlan = { chunkCount: WARN_CHUNK_COUNT, logicalBytes: WARN_LOGICAL_BYTES, networkBytes: WARN_LOGICAL_BYTES };
assert(!shouldWarnChunkPlan(lightPlan), "at threshold does not warn");
const heavyPlan = { chunkCount: WARN_CHUNK_COUNT + 1, logicalBytes: 0, networkBytes: 0 };
assert(shouldWarnChunkPlan(heavyPlan), "chunk count above threshold warns");

assert(formatChunkEstimate(edhPlan).includes("136 chunks"), "formatChunkEstimate readable");

const grid = spatialChunkGrid(edh);
assert(grid !== null, "EDH spatial grid");
assert(grid!.yChunks === 8 && grid!.xChunks === 17, `EDH grid 8×17, got ${grid!.yChunks}×${grid!.xChunks}`);
assert(isSpatiallyMultiChunk(grid!), "EDH is multi-tile spatial");

const tilePlan = planSingleSpatialTile(edh, 0, 0);
assert(tilePlan.imageChunks === 1, `single tile: 1 chunk, got ${tilePlan.imageChunks}`);
assert(tilePlan.logicalBytes === 512 * 512 * 4, `single tile logical bytes, got ${tilePlan.logicalBytes}`);

const ranges = tileIndexRanges(grid!, 7, 16);
assert(ranges.y[0] === 3584 && ranges.y[1] === 4096, "last y tile range");
assert(ranges.x[0] === 8192 && ranges.x[1] === 8193, "last x tile range (partial)");

const regionPlan = planSpatialRegion(edh, 0, 1, 0, 2);
assert(regionPlan.imageChunks === 6, `2×3 region: 6 chunks, got ${regionPlan.imageChunks}`);

const regionRanges = regionIndexRanges(grid!, 0, 1, 0, 2);
assert(regionRanges.y[1] - regionRanges.y[0] === 1024, "region y pixel span");
assert(regionRanges.x[1] - regionRanges.x[0] === 1536, "region x pixel span");
assert(
  formatRegionLoadEstimate(regionPlan).includes("6 chunks"),
  "formatRegionLoadEstimate",
);

assert(
  chunkPickerSpatialMessage(loadPlan, grid!).includes("Select an area"),
  "spatial picker message",
);

console.log("chunk_plan.test.ts: ok");
