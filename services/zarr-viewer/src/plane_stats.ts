import { chunkValue, type ImageAxes, type PlaneData } from "./chunk_utils.js";

/** Bin resolution for histogram display and percentile scale estimation. */
export const VALUE_BIN_COUNT = 500;

export interface PlaneForStats {
  data: PlaneData;
  shape: number[];
  axes: ImageAxes;
  bandStats?: BandValueStats[];
  /** minmax = single-pass extrema only; full = binned histogram. */
  bandStatsLevel?: "minmax" | "full";
}

export interface BandValueStats {
  min: number;
  max: number;
  counts: Uint32Array;
  sampleCount: number;
}

function computeStrides(shape: number[]): number[] {
  const stride = new Array<number>(shape.length);
  let step = 1;
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    stride[axis] = step;
    step *= shape[axis]!;
  }
  return stride;
}

function emptyBandStats(): BandValueStats {
  return {
    min: Infinity,
    max: -Infinity,
    counts: new Uint32Array(VALUE_BIN_COUNT),
    sampleCount: 0,
  };
}

function finalizeBandStats(stats: BandValueStats[]): BandValueStats[] {
  for (const entry of stats) {
    if (entry.sampleCount === 0 || !Number.isFinite(entry.min) || !Number.isFinite(entry.max)) {
      entry.min = 0;
      entry.max = 1;
    }
  }
  return stats;
}

function valueBinIndex(value: number, min: number, span: number): number {
  const t = (value - min) / span;
  return Math.min(
    VALUE_BIN_COUNT - 1,
    Math.max(0, Math.floor(t * (VALUE_BIN_COUNT - 1))),
  );
}

function accumulateMinMax(entry: BandValueStats, value: number): void {
  if (!Number.isFinite(value)) return;
  if (value < entry.min) entry.min = value;
  if (value > entry.max) entry.max = value;
  entry.sampleCount++;
}

function isContiguousUint8Rgb(plane: PlaneForStats): boolean {
  const { data, shape, axes } = plane;
  if (!(data instanceof Uint8Array) || shape.length !== 3 || axes.band !== 2) return false;
  const height = shape[axes.y]!;
  const width = shape[axes.x]!;
  const bands = shape[axes.band]!;
  return bands === 3 && data.length === height * width * bands;
}

function isContiguousUint8Scalar(plane: PlaneForStats): boolean {
  const { data, shape, axes } = plane;
  if (!(data instanceof Uint8Array) || shape.length !== 2 || axes.band >= 0) return false;
  return data.length === shape[axes.y]! * shape[axes.x]!;
}

function isContiguousScalar(plane: PlaneForStats): boolean {
  const { data, shape, axes } = plane;
  if (shape.length !== 2 || axes.band >= 0) return false;
  return data.length === shape[axes.y]! * shape[axes.x]!;
}

/** Linear scan uint8 [H,W,3] — ~10 ms for 850×884 (vs seconds via chunkValue). */
function fastUint8RgbMinMax(data: Uint8Array, width: number, height: number): BandValueStats[] {
  const stats = [emptyBandStats(), emptyBandStats(), emptyBandStats()];
  const rowStride = width * 3;
  for (let y = 0; y < height; y++) {
    let i = y * rowStride;
    const rowEnd = i + rowStride;
    for (; i < rowEnd; i += 3) {
      accumulateMinMax(stats[0]!, data[i]!);
      accumulateMinMax(stats[1]!, data[i + 1]!);
      accumulateMinMax(stats[2]!, data[i + 2]!);
    }
  }
  return finalizeBandStats(stats);
}

/** Single pass min/max + one bin pass for uint8 RGB C-order. */
function fastUint8RgbFullStats(data: Uint8Array, width: number, height: number): BandValueStats[] {
  const stats = fastUint8RgbMinMax(data, width, height);
  for (const entry of stats) {
    entry.counts.fill(0);
  }
  const rowStride = width * 3;
  for (let band = 0; band < 3; band++) {
    const entry = stats[band]!;
    const span = entry.max > entry.min ? entry.max - entry.min : 1;
    for (let y = 0; y < height; y++) {
      let i = y * rowStride + band;
      const rowEnd = i + rowStride;
      for (; i < rowEnd; i += 3) {
        const value = data[i]!;
        if (!Number.isFinite(value)) continue;
        entry.counts[valueBinIndex(value, entry.min, span)]!++;
      }
    }
  }
  return stats;
}

function fastUint8ScalarMinMax(data: Uint8Array): BandValueStats[] {
  const stats = [emptyBandStats()];
  for (let i = 0; i < data.length; i++) {
    accumulateMinMax(stats[0]!, data[i]!);
  }
  return finalizeBandStats(stats);
}

function fastUint8ScalarFullStats(data: Uint8Array): BandValueStats[] {
  const stats = fastUint8ScalarMinMax(data);
  const entry = stats[0]!;
  entry.counts.fill(0);
  const span = entry.max > entry.min ? entry.max - entry.min : 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    if (!Number.isFinite(value)) continue;
    entry.counts[valueBinIndex(value, entry.min, span)]!++;
  }
  return stats;
}

function fastScalarMinMax(data: PlaneData): BandValueStats[] {
  const stats = [emptyBandStats()];
  for (let i = 0; i < data.length; i++) {
    accumulateMinMax(stats[0]!, data[i]!);
  }
  return finalizeBandStats(stats);
}

function fastScalarFullStats(data: PlaneData): BandValueStats[] {
  const stats = fastScalarMinMax(data);
  const entry = stats[0]!;
  entry.counts.fill(0);
  const span = entry.max > entry.min ? entry.max - entry.min : 1;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    if (!Number.isFinite(value)) continue;
    entry.counts[valueBinIndex(value, entry.min, span)]!++;
  }
  return stats;
}

function tryFastMinMax(plane: PlaneForStats): BandValueStats[] | null {
  const { data, shape, axes } = plane;
  if (isContiguousUint8Rgb(plane)) {
    return fastUint8RgbMinMax(data as Uint8Array, shape[axes.x]!, shape[axes.y]!);
  }
  if (isContiguousUint8Scalar(plane)) {
    return fastUint8ScalarMinMax(data as Uint8Array);
  }
  if (isContiguousScalar(plane)) {
    return fastScalarMinMax(data);
  }
  return null;
}

function tryFastFullStats(plane: PlaneForStats): BandValueStats[] | null {
  const { data, shape, axes } = plane;
  if (isContiguousUint8Rgb(plane)) {
    return fastUint8RgbFullStats(data as Uint8Array, shape[axes.x]!, shape[axes.y]!);
  }
  if (isContiguousUint8Scalar(plane)) {
    return fastUint8ScalarFullStats(data as Uint8Array);
  }
  if (isContiguousScalar(plane)) {
    return fastScalarFullStats(data);
  }
  return null;
}

/** Single-pass min/max per band (slow path uses chunkValue). */
export function computePlaneBandMinMax(plane: PlaneForStats): BandValueStats[] {
  const fast = tryFastMinMax(plane);
  if (fast) return fast;

  const { data, shape, axes } = plane;
  const height = shape[axes.y]!;
  const width = shape[axes.x]!;
  const bandCount = axes.band >= 0 ? shape[axes.band]! : 1;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  const stats = Array.from({ length: bandCount }, () => emptyBandStats());

  for (let y = 0; y < height; y++) {
    coords[axes.y] = y;
    for (let x = 0; x < width; x++) {
      coords[axes.x] = x;
      if (axes.band >= 0) {
        for (let band = 0; band < bandCount; band++) {
          coords[axes.band] = band;
          accumulateMinMax(stats[band]!, chunkValue(data, stride, coords));
        }
      } else {
        accumulateMinMax(stats[0]!, chunkValue(data, stride, coords));
      }
    }
  }
  return finalizeBandStats(stats);
}

/** Bin index that contains numeric zero for these stats (null if zero is outside range). */
export function zeroValueBinIndex(stats: BandValueStats): number | null {
  if (stats.min > 0 || stats.max < 0) return null;
  const span = stats.max > stats.min ? stats.max - stats.min : 1;
  return valueBinIndex(0, stats.min, span);
}

/** Histogram display counts: hide the zero bin so padding does not flatten the curve. */
export function histogramDisplayCounts(stats: BandValueStats): number[] {
  const counts = Array.from(stats.counts);
  const zeroBin = zeroValueBinIndex(stats);
  if (zeroBin !== null) counts[zeroBin] = 0;
  return counts;
}

/** Min/max + binned histogram per band. */
export function computePlaneBandStats(plane: PlaneForStats): BandValueStats[] {
  const fast = tryFastFullStats(plane);
  if (fast) return fast;

  const { data, shape, axes } = plane;
  const height = shape[axes.y]!;
  const width = shape[axes.x]!;
  const bandCount = axes.band >= 0 ? shape[axes.band]! : 1;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  const stats = Array.from({ length: bandCount }, () => emptyBandStats());

  for (let y = 0; y < height; y++) {
    coords[axes.y] = y;
    for (let x = 0; x < width; x++) {
      coords[axes.x] = x;
      if (axes.band >= 0) {
        for (let band = 0; band < bandCount; band++) {
          coords[axes.band] = band;
          accumulateMinMax(stats[band]!, chunkValue(data, stride, coords));
        }
      } else {
        accumulateMinMax(stats[0]!, chunkValue(data, stride, coords));
      }
    }
  }

  for (let y = 0; y < height; y++) {
    coords[axes.y] = y;
    for (let x = 0; x < width; x++) {
      coords[axes.x] = x;
      if (axes.band >= 0) {
        for (let band = 0; band < bandCount; band++) {
          coords[axes.band] = band;
          const value = chunkValue(data, stride, coords);
          if (!Number.isFinite(value)) continue;
          const entry = stats[band]!;
          if (entry.sampleCount === 0) continue;
          const span = entry.max > entry.min ? entry.max - entry.min : 1;
          entry.counts[valueBinIndex(value, entry.min, span)]!++;
        }
      } else {
        const value = chunkValue(data, stride, coords);
        if (!Number.isFinite(value)) continue;
        const entry = stats[0]!;
        if (entry.sampleCount === 0) continue;
        const span = entry.max > entry.min ? entry.max - entry.min : 1;
        entry.counts[valueBinIndex(value, entry.min, span)]!++;
      }
    }
  }

  return finalizeBandStats(stats);
}

export function ensurePlaneBandStats(
  plane: PlaneForStats,
  level: "minmax" | "full" = "full",
): BandValueStats[] {
  if (plane.bandStats && (level === "minmax" || plane.bandStatsLevel === "full")) {
    return plane.bandStats;
  }
  if (level === "minmax") {
    plane.bandStats = computePlaneBandMinMax(plane);
    plane.bandStatsLevel = "minmax";
    return plane.bandStats;
  }
  plane.bandStats = computePlaneBandStats(plane);
  plane.bandStatsLevel = "full";
  return plane.bandStats;
}

export function minMaxFromStats(stats: BandValueStats): [number, number] {
  if (stats.sampleCount === 0) return [0, 1];
  const { min, max } = stats;
  return min === max ? [min, min + 1] : [min, max];
}

function binLowEdge(stats: BandValueStats, bin: number): number {
  const span = stats.max > stats.min ? stats.max - stats.min : 1;
  return stats.min + (bin / (VALUE_BIN_COUNT - 1)) * span;
}

function binHighEdge(stats: BandValueStats, bin: number): number {
  const span = stats.max > stats.min ? stats.max - stats.min : 1;
  return stats.min + ((bin + 1) / (VALUE_BIN_COUNT - 1)) * span;
}

/** Percentile bounds from a binned histogram (O(bins), no sort). */
export function percentileFromStats(
  stats: BandValueStats,
  lowPct: number,
  highPct: number,
): [number, number] {
  if (stats.sampleCount === 0) return [0, 1];
  const targetLo = Math.floor((stats.sampleCount * lowPct) / 100);
  const targetHi = Math.ceil((stats.sampleCount * highPct) / 100) - 1;

  let cumulative = 0;
  let lo = stats.min;
  let hi = stats.max;
  for (let bin = 0; bin < VALUE_BIN_COUNT; bin++) {
    cumulative += stats.counts[bin]!;
    if (lo === stats.min && cumulative > targetLo) {
      lo = binLowEdge(stats, bin);
    }
    if (cumulative > targetHi) {
      hi = binHighEdge(stats, bin);
      break;
    }
  }
  return lo === hi ? [lo, lo + 1] : [lo, hi];
}

export function statsForBand(
  plane: PlaneForStats,
  band: number,
  bandStats?: BandValueStats[],
): BandValueStats {
  const stats = bandStats ?? ensurePlaneBandStats(plane);
  return stats[band] ?? stats[0] ?? emptyBandStats();
}

export function bandStatsSlice(
  bandStats: BandValueStats[],
  bandIndices: number[],
): BandValueStats[] {
  return bandIndices.map((band) => bandStats[band] ?? emptyBandStats());
}
