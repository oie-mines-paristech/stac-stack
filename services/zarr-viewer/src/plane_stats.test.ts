import {
  computePlaneBandMinMax,
  computePlaneBandStats,
  histogramDisplayCounts,
  percentileFromStats,
  zeroValueBinIndex,
  VALUE_BIN_COUNT,
} from "./plane_stats.js";
import type { PlaneForStats } from "./plane_stats.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const plane: PlaneForStats = {
  data: new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]),
  shape: [2, 2, 3],
  axes: { time: -1, band: 2, y: 0, x: 1 },
};

const stats = computePlaneBandStats(plane);
assert(stats.length === 3, "three band stats");
assert(stats[0]!.sampleCount === 4, "four pixels per band");
assert(stats[0]!.counts.length === VALUE_BIN_COUNT, "500 bins");
assert(stats[0]!.min === 0 && stats[0]!.max === 90, "band 0 min/max");

const uniform = new Uint32Array(Array.from({ length: 100 }, (_, index) => index));
const uniformPlane: PlaneForStats = {
  data: uniform,
  shape: [10, 10],
  axes: { time: -1, band: -1, y: 0, x: 1 },
};
const uniformStats = computePlaneBandStats(uniformPlane)[0]!;
const [lo, hi] = percentileFromStats(uniformStats, 5, 95);
assert(lo <= 5 && hi >= 94, "binned percentile near P5–P95 on uniform 0–99");

const zeroHeavy = computePlaneBandStats({
  data: new Uint8Array([0, 0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80]),
  shape: [2, 2, 3],
  axes: { time: -1, band: 2, y: 0, x: 1 },
});
const display = histogramDisplayCounts(zeroHeavy[0]!);
const zeroBin = zeroValueBinIndex(zeroHeavy[0]!);
assert(zeroBin === 0, "zero maps to first bin when min is 0");
assert(display[zeroBin!] === 0, "zero bin hidden from histogram display");
assert(
  display.slice(1).some((count) => count > 0),
  "non-zero bins remain visible",
);

const rgbPlane: import("./plane_stats.js").PlaneForStats = {
  data: new Uint8Array([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]),
  shape: [2, 2, 3],
  axes: { time: -1, band: 2, y: 0, x: 1 },
};
const fastMin = computePlaneBandMinMax(rgbPlane);
rgbPlane.bandStats = undefined;
rgbPlane.bandStatsLevel = undefined;
// force slow path by using non-contiguous layout marker - use planar shape instead
const slowPlane = {
  data: rgbPlane.data,
  shape: [3, 2, 2] as number[],
  axes: { time: -1, band: 0, y: 1, x: 2 },
};
const slowMin = computePlaneBandMinMax(slowPlane);
assert(fastMin[0]!.min === slowMin[0]!.min, "fast/slow minmax band0 min match");

console.log("plane_stats.test.ts: ok");
