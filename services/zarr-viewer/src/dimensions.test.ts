import { buildDatasetSchema, isRgbBandName } from "./dimensions.js";
import { isNumericCoordinateDtype, normalizeDtype } from "./dimensions.js";

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

const rowsColumns = buildDatasetSchema("https://example.com/frp.zarr/", {
  flags: {
    shape: [2400, 3000],
    dimension_names: ["rows", "columns"],
    data_type: "uint8",
    node_type: "array",
  },
});
assert(rowsColumns.variables.length === 1, "rows/columns recognized as image grid");
assert(rowsColumns.variables[0].axes.find((a) => a.role === "y")?.name === "rows", "rows mapped to y");
assert(rowsColumns.variables[0].axes.find((a) => a.role === "x")?.name === "columns", "columns mapped to x");

assert(normalizeDtype("float32") === "float32", "normalize string dtype");
assert(
  normalizeDtype({ name: "fixed_length_utf32", configuration: { length_bytes: 8 } }) ===
    "fixed_length_utf32",
  "normalize v3 string dtype",
);
assert(
  !isNumericCoordinateDtype({
    name: "fixed_length_utf32",
    configuration: { length_bytes: 8 },
  }),
  "utf32 coord is not numeric",
);
assert(isNumericCoordinateDtype("uint64"), "uint64 coord is numeric");

const stringBandSchema = buildDatasetSchema("https://example.com/sophia-old.zarr/", {
  band: {
    shape: [4],
    data_type: { name: "fixed_length_utf32", configuration: { length_bytes: 8 } },
    dimension_names: ["band"],
    attributes: { names: ["R", "G1", "B", "G2"] },
    node_type: "array",
  },
  radiance: {
    shape: [10, 4, 8, 8],
    data_type: "float64",
    dimension_names: ["time", "band", "y", "x"],
    attributes: {},
    node_type: "array",
  },
  time: {
    shape: [10],
    data_type: "uint64",
    dimension_names: ["time"],
    attributes: { standard_name: "time", units: "seconds since 1970-01-01" },
    node_type: "array",
  },
});
assert(stringBandSchema.coordinates.band?.labels?.length === 4, "band labels from attrs");
assert(stringBandSchema.coordinates.band?.dtype === "fixed_length_utf32", "band dtype normalized");

assert(isRgbBandName("rgb"), "rgb is rgb band name");
assert(isRgbBandName("RGB"), "RGB is rgb band name");
assert(isRgbBandName("rgba"), "rgba prefix matches rgb band heuristic");
assert(!isRgbBandName("bracket"), "bracket is not rgb band name");

const hdrLikeSchema = buildDatasetSchema("https://example.com/hdr.zarr/", {
  rgb: {
    shape: [3],
    data_type: { name: "fixed_length_utf32", configuration: { length_bytes: 4 } },
    dimension_names: ["rgb"],
    attributes: { long_name: "white-balance colour channel" },
    node_type: "array",
  },
  time: {
    shape: [2],
    data_type: "uint64",
    dimension_names: ["time"],
    attributes: { standard_name: "time", units: "seconds since 1970-01-01" },
    node_type: "array",
  },
  hdr_image: {
    shape: [2, 8, 8, 3],
    data_type: "uint8",
    dimension_names: ["time", "sensor_y", "sensor_x", "rgb"],
    attributes: { long_name: "HDR colour image" },
    node_type: "array",
  },
});
const hdrVar = hdrLikeSchema.variables.find((v) => v.path === "hdr_image");
assert(hdrVar !== undefined, "hdr_image is an image variable");
const rgbAxis = hdrVar!.axes.find((a) => a.name === "rgb");
assert(rgbAxis?.role === "band", "rgb dimension classified as band");
assert(
  hdrLikeSchema.variables[0].axes.filter((a) => a.role === "other").length === 0,
  "hdr_image has no other-dim dropdown axes",
);

console.log("dimensions.test.ts: ok");
