import { sampleColormap } from "../colormap.js";
import { formatSigFig, formatValue } from "../format.js";

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
  const minLabel = document.querySelector<HTMLElement>("#legend-min");
  if (!container || !bar || !maxLabel || !minLabel) return;

  if (!visible || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const height = 14;
  const width = Math.max(120, bar.clientWidth || 240);
  bar.width = width;
  bar.height = height;
  const ctx = bar.getContext("2d");
  if (!ctx) return;

  const image = ctx.createImageData(width, height);
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    const [r, g, b] = sampleColormap(colormap, t);
    for (let y = 0; y < height; y++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  minLabel.textContent = formatSigFig(min);
  maxLabel.textContent = formatValue(max, unit);
}
