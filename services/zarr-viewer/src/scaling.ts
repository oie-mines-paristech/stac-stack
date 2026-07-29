export function arrayMinMax(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return min === max ? [min, min + 1] : [min, max];
}

export function percentileMinMax(
  values: number[],
  low = 5,
  high = 95,
): [number, number] {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return [0, 1];
  const lo = finite[Math.floor((finite.length * low) / 100)] ?? finite[0];
  const hi = finite[Math.ceil((finite.length * high) / 100) - 1] ?? finite.at(-1)!;
  return lo === hi ? [lo, lo + 1] : [lo, hi];
}

export function resolveScaleRange(
  samples: number[],
  autoscale: boolean,
  cfMin: unknown,
  cfMax: unknown,
): [number, number] {
  if (autoscale) {
    return percentileMinMax(samples, 5, 95);
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
  samples: number[],
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
