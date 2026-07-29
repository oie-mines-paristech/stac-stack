import { sampleColormap } from "../colormap.js";
import { formatValue } from "../format.js";

export function updateColorLegend(
  visible: boolean,
  colormap: string,
  min: number,
  max: number,
  unit?: string,
): void {
  const container = document.querySelector<HTMLElement>("#color-legend");
  const bar = document.querySelector<HTMLCanvasElement>("#color-legend-bar");
  const maxLabel = document.querySelector<HTMLElement>("#legend-max");
  const midLabel = document.querySelector<HTMLElement>("#legend-mid");
  const minLabel = document.querySelector<HTMLElement>("#legend-min");
  if (!container || !bar || !maxLabel || !midLabel || !minLabel) return;

  if (!visible || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const width = 24;
  const height = Math.max(120, bar.clientHeight || 160);
  bar.width = width;
  bar.height = height;
  const ctx = bar.getContext("2d");
  if (!ctx) return;

  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const t = 1 - y / (height - 1);
    const [r, g, b] = sampleColormap(colormap, t);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const mid = (min + max) / 2;
  maxLabel.textContent = formatValue(max, unit);
  midLabel.textContent = formatValue(mid, unit);
  minLabel.textContent = formatValue(min, unit);
}
