export const DEFAULT_COLORMAP = "viridis";

export const COLORMAP_NAMES = [
  "viridis",
  "plasma",
  "inferno",
  "magma",
  "cividis",
  "turbo",
  "hot",
  "coolwarm",
  "RdYlBu",
  "terrain",
] as const;

export type ColormapName = (typeof COLORMAP_NAMES)[number];

type Rgb = [number, number, number];

const STOPS: Record<ColormapName, Rgb[]> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  plasma: [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]],
  inferno: [[0, 0, 4], [81, 15, 99], [183, 55, 121], [252, 142, 78], [252, 255, 164]],
  magma: [[0, 0, 4], [81, 18, 102], [183, 55, 121], [252, 137, 114], [252, 253, 191]],
  cividis: [[0, 32, 76], [62, 73, 137], [134, 135, 70], [253, 231, 37], [255, 234, 70]],
  turbo: [[48, 18, 59], [67, 82, 181], [33, 145, 140], [253, 187, 53], [231, 35, 35]],
  hot: [[0, 0, 0], [230, 0, 0], [255, 210, 0], [255, 255, 255]],
  coolwarm: [[59, 76, 192], [221, 221, 221], [180, 4, 38]],
  RdYlBu: [[165, 0, 38], [215, 96, 39], [255, 255, 191], [44, 123, 182], [49, 54, 149]],
  terrain: [[0, 152, 255], [166, 217, 106], [255, 255, 191], [205, 133, 63], [255, 255, 255]],
};

const luts = new Map<string, Uint8Array>();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateStops(stops: Rgb[], t: number): Rgb {
  const n = stops.length - 1;
  const x = Math.max(0, Math.min(1, t)) * n;
  const index = Math.min(n - 1, Math.floor(x));
  const frac = x - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    Math.round(lerp(a[0], b[0], frac)),
    Math.round(lerp(a[1], b[1], frac)),
    Math.round(lerp(a[2], b[2], frac)),
  ];
}

function buildLut(name: string): Uint8Array {
  const stops = STOPS[name as ColormapName];
  if (!stops) {
    return buildLut(DEFAULT_COLORMAP);
  }
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = interpolateStops(stops, i / 255);
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
}

export function getColormapLut(name: string): Uint8Array {
  const key = isColormapName(name) ? name : DEFAULT_COLORMAP;
  let lut = luts.get(key);
  if (!lut) {
    lut = buildLut(key);
    luts.set(key, lut);
  }
  return lut;
}

export function isColormapName(name: string): name is ColormapName {
  return (COLORMAP_NAMES as readonly string[]).includes(name);
}

export function sampleColormap(name: string, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  const lut = getColormapLut(name);
  const index = Math.min(255, Math.round(clamped * 255));
  return [lut[index * 3], lut[index * 3 + 1], lut[index * 3 + 2]];
}

const swatchCache = new Map<string, string>();

export function getColormapSwatchDataUrl(name: string, width = 64, height = 12): string {
  const key = `${isColormapName(name) ? name : DEFAULT_COLORMAP}:${width}x${height}`;
  const cached = swatchCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const lut = getColormapLut(name);
  const image = ctx.createImageData(width, height);
  for (let x = 0; x < width; x++) {
    const index = Math.min(255, Math.round((x / (width - 1)) * 255));
    const r = lut[index * 3];
    const g = lut[index * 3 + 1];
    const b = lut[index * 3 + 2];
    for (let y = 0; y < height; y++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  swatchCache.set(key, dataUrl);
  return dataUrl;
}

export function colormapCssGradient(name: string): string {
  const stops = STOPS[isColormapName(name) ? name : DEFAULT_COLORMAP];
  const parts = stops.map(([r, g, b], index) => {
    const pct = (index / (stops.length - 1)) * 100;
    return `rgb(${r}, ${g}, ${b}) ${pct}%`;
  });
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
