import { formatScaleInput, formatSigFig, formatValue } from "./format.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(formatSigFig(12.345) === "12.35", "12.345 -> 12.35");
assert(formatSigFig(1234.5) === "1235", "1234.5 -> 1235");
assert(formatSigFig(123456.5) === "1.235e5", "large value uses scientific");
assert(formatSigFig(1e-6) === "1e-6", "small value uses scientific");
assert(formatSigFig(0) === "0", "zero");
assert(formatSigFig(NaN) === "NaN", "NaN");

assert(formatValue(12.35, "K") === "12.35 [K]", "with unit");
assert(formatValue(12.35) === "12.35", "without unit");

assert(formatScaleInput(285.123456) === "285.1235", "scale input 4 decimals");
assert(formatScaleInput(123456.789) === "123456.789", "scale input no scientific");

console.log("format.test.ts: ok");
