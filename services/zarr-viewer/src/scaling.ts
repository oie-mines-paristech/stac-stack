import type { BandValueStats } from "./plane_stats.js";
import { minMaxFromStats, percentileFromStats } from "./plane_stats.js";

export type ScaleMode = "none" | "minmax" | "percentile";

export const PERCENTILE_LOW = 5;
export const PERCENTILE_HIGH = 95;

/** Default display scale: byte images use data min–max; floats use percentile. */
export function defaultScaleModeForDtype(dtype: string): ScaleMode {
  const normalized = dtype.toLowerCase();
  if (normalized === "int8" || normalized === "uint8") return "minmax";
  return "percentile";
}

/** Full native value range for integer dtypes (None scale without manual bounds). */
export function integerDtypeDisplayRange(dtype: string): [number, number] | null {
  switch (dtype.toLowerCase()) {
    case "uint8":
      return [0, 255];
    case "int8":
      return [-128, 127];
    case "uint16":
      return [0, 65535];
    case "int16":
      return [-32768, 32767];
    case "uint32":
      return [0, 4294967295];
    case "int32":
      return [-2147483648, 2147483647];
    default:
      return null;
  }
}

export function defaultManualRangesForDtype(dtype: string, bandCount: number): ScaleRange[] {
  const full = integerDtypeDisplayRange(dtype);
  if (full) {
    const [min, max] = full;
    return Array.from({ length: Math.max(1, bandCount) }, () => ({ min, max }));
  }
  return [];
}

export function arrayMinMax(values: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return min === max ? [min, min + 1] : [min, max];
}

export function percentileMinMaxArray(
  values: ArrayLike<number>,
  low = 1,
  high = 99,
): [number, number] {
  const finite: number[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (Number.isFinite(value)) finite.push(value);
  }
  if (finite.length === 0) return [0, 1];
  finite.sort((a, b) => a - b);
  const lo = finite[Math.floor((finite.length * low) / 100)] ?? finite[0];
  const hi = finite[Math.ceil((finite.length * high) / 100) - 1] ?? finite.at(-1)!;
  return lo === hi ? [lo, lo + 1] : [lo, hi];
}

/** @deprecated use percentileMinMaxArray on TypedArray directly */
export function percentileMinMax(
  values: number[],
  low = 5,
  high = 95,
): [number, number] {
  return percentileMinMaxArray(values, low, high);
}

export function scaleRangeForMode(
  samples: ArrayLike<number>,
  scaleMode: ScaleMode,
  manual: ScaleRange | undefined,
  cfMin: unknown,
  cfMax: unknown,
): [number, number] {
  if (scaleMode === "none") {
    return resolveManualScaleRange(manual, samples, cfMin, cfMax);
  }
  if (scaleMode === "minmax") {
    return arrayMinMax(samples);
  }
  return percentileMinMaxArray(samples, PERCENTILE_LOW, PERCENTILE_HIGH);
}

/** Scale range from precomputed band histogram stats (shared with histogram UI). */
export function scaleRangeFromBandStats(
  stats: BandValueStats,
  scaleMode: ScaleMode,
  manual: ScaleRange | undefined,
  cfMin: unknown,
  cfMax: unknown,
): [number, number] {
  if (scaleMode === "none") {
    if (manual && Number.isFinite(manual.min) && Number.isFinite(manual.max) && manual.max > manual.min) {
      return [manual.min, manual.max];
    }
    const min = Number(cfMin);
    const max = Number(cfMax);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      return [min, max];
    }
    return minMaxFromStats(stats);
  }
  if (scaleMode === "minmax") {
    return minMaxFromStats(stats);
  }
  return percentileFromStats(stats, PERCENTILE_LOW, PERCENTILE_HIGH);
}

export function resolveScaleRange(
  samples: ArrayLike<number>,
  autoscale: boolean,
  cfMin: unknown,
  cfMax: unknown,
): [number, number] {
  if (autoscale) {
    return arrayMinMax(samples);
  }
  const min = Number(cfMin);
  const max = Number(cfMax);
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    return [min, max];
  }
  return arrayMinMax(samples);
}

export interface ScaleRange {
  min: number;
  max: number;
}

export function resolveManualScaleRange(
  manual: ScaleRange | undefined,
  samples: ArrayLike<number>,
  cfMin: unknown,
  cfMax: unknown,
): [number, number] {
  if (manual && Number.isFinite(manual.min) && Number.isFinite(manual.max) && manual.max > manual.min) {
    return [manual.min, manual.max];
  }
  return resolveScaleRange(samples, false, cfMin, cfMax);
}

export function cfScaleBounds(attributes: Record<string, unknown>): {
  min?: number;
  max?: number;
} {
  const min = Number(attributes.min_value ?? attributes.valid_min);
  const max = Number(attributes.max_value ?? attributes.valid_max);
  return {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
  };
}

/** Apply CF valid range only when it overlaps observed data; never return max <= min. */
export function clipRangeToCfBounds(
  min: number,
  max: number,
  cfMin?: number,
  cfMax?: number,
): { min: number; max: number } {
  if (cfMin !== undefined && cfMax !== undefined && cfMax > cfMin) {
    const clippedMin = Math.max(min, cfMin);
    const clippedMax = Math.min(max, cfMax);
    if (clippedMax > clippedMin) {
      return { min: clippedMin, max: clippedMax };
    }
  }
  return { min, max: min === max ? max + 1 : max };
}

export function defaultRgbBands(
  labels: string[] | undefined,
  bandCount: number,
): [number, number, number] {
  const find = (candidates: string[]): number | undefined => {
    if (!labels) return undefined;
    for (const candidate of candidates) {
      const index = labels.findIndex(
        (label) => label.toLowerCase() === candidate.toLowerCase(),
      );
      if (index >= 0) return index;
    }
    return undefined;
  };

  const r = find(["R", "Red"]) ?? 0;
  const g = find(["G", "G1", "Green"]) ?? Math.min(1, bandCount - 1);
  const b = find(["B", "Blue"]) ?? Math.min(2, bandCount - 1);
  return [r, g, b];
}

export function rgbBandsEqual(
  a: [number, number, number],
  b: [number, number, number],
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
