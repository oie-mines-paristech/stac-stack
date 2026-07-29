import type { ScaleRange } from "./scaling.js";

export function parseScaleParam(value: string): ScaleRange[] | undefined {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  const ranges: ScaleRange[] = [];
  for (const part of parts) {
    const [minText, maxText] = part.split(":");
    const min = Number(minText);
    const max = Number(maxText);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return undefined;
    ranges.push({ min, max });
  }
  return ranges;
}

export function serializeScaleParam(ranges: ScaleRange[]): string {
  return ranges.map((range) => `${range.min}:${range.max}`).join(",");
}
