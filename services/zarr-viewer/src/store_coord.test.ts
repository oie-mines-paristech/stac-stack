import { shouldFetchCoordinateValues } from "./store.js";
import type { CoordinateMeta } from "./dimensions.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const stringBand: CoordinateMeta = {
  path: "band",
  dimensionNames: ["band"],
  attributes: { names: ["R", "G1", "B", "G2"] },
  labels: ["R", "G1", "B", "G2"],
  dtype: "fixed_length_utf32",
  shape: [4],
};

assert(!shouldFetchCoordinateValues(stringBand), "skip fetch when labels exist");

const numericTime: CoordinateMeta = {
  path: "time",
  dimensionNames: ["time"],
  attributes: { units: "seconds since 1970-01-01" },
  dtype: "uint64",
  shape: [100],
};

assert(shouldFetchCoordinateValues(numericTime), "fetch numeric time coordinate");

console.log("store_coord.test.ts: ok");
