import { chunkValue } from "./chunk_utils.js";
import type { ImagePlane } from "./render.js";

const BIN_COUNT = 64;
const FALLBACK_COLORS = ["#e74c3c", "#2ecc71", "#3498db", "#9b59b6", "#f1c40f", "#1abc9c"];

export interface BandHistogramSeries {
  label: string;
  color: string;
  counts: number[];
  displayed: boolean;
}

function computeStrides(shape: number[]): number[] {
  const stride = new Array<number>(shape.length);
  let step = 1;
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    stride[axis] = step;
    step *= shape[axis];
  }
  return stride;
}

function finiteMin(values: number[]): number {
  let min = Infinity;
  for (const value of values) min = Math.min(min, value);
  return min;
}

function finiteMax(values: number[]): number {
  let max = -Infinity;
  for (const value of values) max = Math.max(max, value);
  return max;
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
  return hexToRgba(FALLBACK_COLORS[index % FALLBACK_COLORS.length], alpha);
}

export function buildBandHistogramSeries(
  plane: ImagePlane,
  bandLabels: string[] | undefined,
  rgbBandIndices: number[] | null,
): BandHistogramSeries[] {
  const { data, shape, axes } = plane;
  const stride = computeStrides(shape);
  const coords = new Array<number>(shape.length).fill(0);
  const height = shape[axes.y];
  const width = shape[axes.x];

  const series: BandHistogramSeries[] = [];
  const bandCount = axes.band >= 0 ? shape[axes.band] : 1;

  for (let band = 0; band < bandCount; band++) {
    const values: number[] = [];
    for (let y = 0; y < height; y++) {
      coords[axes.y] = y;
      for (let x = 0; x < width; x++) {
        coords[axes.x] = x;
        if (axes.band >= 0) coords[axes.band] = band;
        const value = chunkValue(data, stride, coords);
        if (Number.isFinite(value)) values.push(value);
      }
    }
    if (values.length === 0) continue;

    const min = finiteMin(values);
    const max = finiteMax(values);
    const counts = new Array<number>(BIN_COUNT).fill(0);
    const span = max > min ? max - min : 1;
    for (const value of values) {
      const bin = Math.min(BIN_COUNT - 1, Math.floor(((value - min) / span) * (BIN_COUNT - 1)));
      counts[bin]++;
    }

    const label = bandLabels?.[band] ?? (bandCount === 1 ? "value" : `band ${band}`);
    const displayed = rgbBandIndices ? rgbBandIndices.includes(band) : band === 0;
    series.push({
      label,
      color: bandColor(label, band, displayed),
      counts,
      displayed,
    });
  }

  return series;
}

export function renderBandHistogram(
  canvas: HTMLCanvasElement,
  series: BandHistogramSeries[],
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

  const pad = { left: 8, right: 8, top: 8, bottom: 20 };
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
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      const x = pad.left + (bin / (BIN_COUNT - 1)) * plotW;
      const barH = (band.counts[bin] / maxCount) * plotH;
      const y = pad.top + plotH - barH;
      if (bin === 0) ctx.moveTo(x, pad.top + plotH);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.closePath();
    ctx.fill();
  }

  ctx.font = "11px system-ui, sans-serif";
  let legendX = pad.left;
  const legendY = height - 6;
  for (const band of series) {
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
): void {
  if (!plane) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth || 260;
    const height = canvas.clientHeight || 140;
    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  renderBandHistogram(canvas, buildBandHistogramSeries(plane, bandLabels, rgbBandIndices));
}
