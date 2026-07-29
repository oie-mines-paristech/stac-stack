import { buildDatasetSchema } from "./dimensions.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const consolidated = {
  latitude: {
    shape: [721],
    data_type: "float32",
    dimension_names: ["latitude"],
    attributes: { standard_name: "latitude", units: "degrees_north" },
    node_type: "array",
  },
  longitude: {
    shape: [1440],
    data_type: "float32",
    dimension_names: ["longitude"],
    attributes: { standard_name: "longitude", units: "degrees_east" },
    node_type: "array",
  },
  time: {
    shape: [100],
    data_type: "int64",
    dimension_names: ["time"],
    attributes: { standard_name: "time", units: "seconds since 1970-01-01" },
    node_type: "array",
  },
  t2m: {
    shape: [100, 721, 1440],
    data_type: "float32",
    dimension_names: ["time", "latitude", "longitude"],
    attributes: { standard_name: "air_temperature" },
    node_type: "array",
  },
};

const schema = buildDatasetSchema("https://example.com/data.zarr/", consolidated);
assert(schema.variables.length === 1, "detects one image variable");
assert(schema.variables[0].path === "t2m", "image variable path");

const variable = schema.variables[0];
const xAxis = variable.axes.find((axis) => axis.role === "x");
const yAxis = variable.axes.find((axis) => axis.role === "y");
assert(xAxis?.name === "longitude", "longitude mapped to x");
assert(yAxis?.name === "latitude", "latitude mapped to y");

const timeVolume = buildDatasetSchema("https://example.com/pixel.zarr/", {
  data: {
    shape: [100, 512, 512],
    dimension_names: ["time", "y", "x"],
    data_type: "float32",
    node_type: "array",
  },
});
assert(timeVolume.variables.length === 1, "time + y + x recognized as image cube");

const simple2d = buildDatasetSchema("https://example.com/simple.zarr/", {
  image: {
    shape: [512, 512],
    dimension_names: ["lat", "lon"],
    data_type: "float32",
    node_type: "array",
  },
});
assert(simple2d.variables.length === 1, "lat/lon short names recognized");

console.log("dimensions.test.ts: ok");
