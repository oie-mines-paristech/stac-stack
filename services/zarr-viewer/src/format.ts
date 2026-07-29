export function formatScaleInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 10_000) / 10_000;
  let text = rounded.toFixed(4).replace(/\.?0+$/, "");
  if (text === "-0") text = "0";
  return text;
}

export function formatSigFig(value: number, sigFigs = 4): string {
  if (!Number.isFinite(value)) return "NaN";
  if (value === 0) return "0";

  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-5) {
    return value
      .toExponential(sigFigs - 1)
      .replace(/e\+/i, "e")
      .replace(/(\.\d*?)0+e/i, "$1e")
      .replace(/\.e/i, "e");
  }

  return Number(value.toPrecision(sigFigs)).toString();
}

export function formatValue(value: number, unit?: string): string {
  const text = formatSigFig(value);
  return unit?.trim() ? `${text} [${unit.trim()}]` : text;
}

/** Compact formatter for coordinates (lat/lon/time indices) — no unit suffix. */
export function formatCoord(value: number): string {
  return formatSigFig(value);
}
