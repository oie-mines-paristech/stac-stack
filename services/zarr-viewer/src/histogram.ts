import { formatValue } from "./format.js";
import type { ImagePlane } from "./render.js";
import {
  ensurePlaneBandStats,
  histogramDisplayCounts,
  type BandValueStats,
  VALUE_BIN_COUNT,
} from "./plane_stats.js";

const FALLBACK_COLORS = ["#e74c3c", "#2ecc71", "#3498db", "#9b59b6", "#f1c40f", "#1abc9c"];

export interface BandHistogramSeries {
  label: string;
  color: string;
  counts: number[];
  displayed: boolean;
  rawMin: number;
  rawMax: number;
}

export interface HistogramScaleMarker {
  label: string;
  color: string;
  min: number;
  max: number;
}

export interface HistogramAxisDomain {
  min: number;
  max: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function bandColor(label: string | undefined, index: number, displayed: boolean): string {
  const alpha = displayed ? 0.65 : 0.35;
  const lower = label?.toLowerCase() ?? "";
  if (lower === "r" || lower === "red") return `rgba(231, 76, 60, ${alpha})`;
  if (lower === "g" || lower === "g1" || lower === "green") return `rgba(46, 204, 113, ${alpha})`;
  if (lower === "b" || lower === "blue") return `rgba(52, 152, 219, ${alpha})`;
  if (lower === "g2") return `rgba(26, 188, 156, ${alpha})`;
  return hexToRgba(FALLBACK_COLORS[index % FALLBACK_COLORS.length]!, alpha);
}

export function histogramAxisDomain(series: BandHistogramSeries[]): HistogramAxisDomain | null {
  if (series.length === 0) return null;
  const rawMin = Math.min(...series.map((item) => item.rawMin));
  const rawMax = Math.max(...series.map((item) => item.rawMax));
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return null;
  const min = rawMin < 0 ? rawMin : 0;
  const max = rawMax <= min ? min + 1 : rawMax;
  return { min, max };
}

function seriesFromBandStats(
  stats: BandValueStats[],
  bandLabels: string[] | undefined,
  rgbBandIndices: number[] | null,
): BandHistogramSeries[] {
  return stats.map((entry, band) => {
    const displayed = rgbBandIndices ? rgbBandIndices.includes(band) : band === 0;
    const label = bandLabels?.[band] ?? (stats.length === 1 ? "value" : `band ${band}`);
    return {
      label,
      color: bandColor(label, band, displayed),
      counts: histogramDisplayCounts(entry),
      displayed,
      rawMin: entry.min,
      rawMax: entry.max,
    };
  });
}

export function buildBandHistogramSeries(
  plane: ImagePlane,
  bandLabels: string[] | undefined,
  rgbBandIndices: number[] | null,
  axisDomain?: HistogramAxisDomain | null,
): BandHistogramSeries[] {
  void axisDomain;
  const stats = ensurePlaneBandStats(plane, "full");
  return seriesFromBandStats(stats, bandLabels, rgbBandIndices);
}

function valueToX(
  value: number,
  domain: HistogramAxisDomain,
  padLeft: number,
  plotW: number,
): number {
  const span = domain.max > domain.min ? domain.max - domain.min : 1;
  const t = (value - domain.min) / span;
  return padLeft + Math.max(0, Math.min(1, t)) * plotW;
}

function drawScaleMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  baselineY: number,
  color: string,
  direction: "min" | "max",
): void {
  const height = 6;
  const width = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (direction === "min") {
    ctx.moveTo(x, baselineY + 2 + height / 2);
    ctx.lineTo(x + width, baselineY + 2);
    ctx.lineTo(x + width, baselineY + 2 + height);
  } else {
    ctx.moveTo(x, baselineY + 2);
    ctx.lineTo(x, baselineY + 2 + height);
    ctx.lineTo(x + width, baselineY + 2 + height / 2);
  }
  ctx.closePath();
  ctx.fill();
}

export function renderBandHistogram(
  canvas: HTMLCanvasElement,
  series: BandHistogramSeries[],
  unit?: string,
  markers?: HistogramScaleMarker[],
  axisDomain?: HistogramAxisDomain | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth || 260;
  const height = canvas.clientHeight || 140;
  canvas.width = Math.floor(width * devicePixelRatio);
  canvas.height = Math.floor(height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (series.length === 0) {
    ctx.fillStyle = "#9aa4b2";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("No finite values", 8, 20);
    return;
  }

  const domain = axisDomain ?? histogramAxisDomain(series);
  if (!domain) return;

  const binCount = series[0]?.counts.length ?? VALUE_BIN_COUNT;
  const pad = { left: 8, right: 8, top: 8, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  let maxCount = 1;
  for (const item of series) {
    for (const count of item.counts) maxCount = Math.max(maxCount, count);
  }

  ctx.strokeStyle = "#394150";
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  for (const band of series) {
    ctx.fillStyle = band.color;
    ctx.beginPath();
    for (let bin = 0; bin < binCount; bin++) {
      const x = pad.left + (bin / (binCount - 1)) * plotW;
      const barH = (band.counts[bin]! / maxCount) * plotH;
      const y = pad.top + plotH - barH;
      if (bin === 0) ctx.moveTo(x, pad.top + plotH);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.closePath();
    ctx.fill();
  }

  const baselineY = pad.top + plotH;
  ctx.strokeStyle = "#6b7280";
  ctx.fillStyle = "#9aa4b2";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textBaseline = "top";

  ctx.beginPath();
  ctx.moveTo(pad.left, baselineY);
  ctx.lineTo(pad.left, baselineY + 4);
  ctx.moveTo(pad.left + plotW, baselineY);
  ctx.lineTo(pad.left + plotW, baselineY + 4);
  ctx.stroke();

  const minLabel = formatValue(domain.min, unit);
  const maxLabel = formatValue(domain.max, unit);
  ctx.fillText(minLabel, pad.left, baselineY + 6);
  const maxWidth = ctx.measureText(maxLabel).width;
  ctx.fillText(maxLabel, pad.left + plotW - maxWidth, baselineY + 6);

  if (markers) {
    for (const marker of markers) {
      const minX = valueToX(marker.min, domain, pad.left, plotW);
      const maxX = valueToX(marker.max, domain, pad.left, plotW);
      drawScaleMarker(ctx, minX, baselineY, marker.color, "min");
      drawScaleMarker(ctx, maxX, baselineY, marker.color, "max");
    }
  }

  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  let legendX = pad.left;
  const legendY = height - 4;
  for (const band of series) {
    if (!band.displayed && series.some((item) => item.displayed)) continue;
    ctx.fillStyle = band.color;
    ctx.fillRect(legendX, legendY - 9, 10, 10);
    ctx.fillStyle = "#c3cad4";
    ctx.fillText(band.label, legendX + 14, legendY);
    legendX += ctx.measureText(band.label).width + 26;
    if (legendX > width - 40) break;
  }
}

export function updateHistogram(
  canvas: HTMLCanvasElement,
  plane: ImagePlane | null,
  bandLabels: string[] | undefined,
  rgbBandIndices: number[] | null,
  markers?: HistogramScaleMarker[],
  unit?: string,
): void {
  if (!plane) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = Math.floor((canvas.clientWidth || 260) * devicePixelRatio);
    canvas.height = Math.floor((canvas.clientHeight || 140) * devicePixelRatio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const series = buildBandHistogramSeries(plane, bandLabels, rgbBandIndices, null);
  const domain = histogramAxisDomain(series);
  renderBandHistogram(canvas, series, unit, markers, domain);
}

export { VALUE_BIN_COUNT };
