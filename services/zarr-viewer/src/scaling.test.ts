import {
  clipRangeToCfBounds,
  cfScaleBounds,
  defaultScaleModeForDtype,
  integerDtypeDisplayRange,
  percentileMinMaxArray,
  PERCENTILE_HIGH,
  PERCENTILE_LOW,
} from "./scaling.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const attrs = { valid_min: 0, valid_max: 1 };
const bounds = cfScaleBounds(attrs);
assert(bounds.min === 0 && bounds.max === 1, "cfScaleBounds reads valid_min/max");

const clipped = clipRangeToCfBounds(-1, 0, bounds.min, bounds.max);
assert(clipped.min === -1 && clipped.max === 0, "CF bounds ignored when they exclude data");

const overlapping = clipRangeToCfBounds(0.2, 0.8, bounds.min, bounds.max);
assert(overlapping.min === 0.2 && overlapping.max === 0.8, "CF bounds kept when overlapping");

const uniform = new Float32Array(Array.from({ length: 100 }, (_, index) => index));
const [uLo, uHi] = percentileMinMaxArray(uniform, PERCENTILE_LOW, PERCENTILE_HIGH);
assert(uLo === 5 && uHi === 94, "percentileMinMaxArray P5–P95 on uniform 0–99");

assert(defaultScaleModeForDtype("int8") === "minmax", "int8 defaults to minmax scale");
assert(defaultScaleModeForDtype("uint8") === "minmax", "uint8 defaults to minmax scale");
assert(defaultScaleModeForDtype("float64") === "percentile", "float defaults to percentile");

const uint8Range = integerDtypeDisplayRange("uint8");
assert(uint8Range?.[0] === 0 && uint8Range?.[1] === 255, "uint8 native range");

console.log("scaling.test.ts: ok");
