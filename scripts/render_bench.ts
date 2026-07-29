/**
 * Render benchmark: synthetic 8192×4096 plane (scalar).
 * Usage: npx tsx scripts/render_bench.ts [--label before|after]
 */
import { performance } from "node:perf_hooks";

const label = process.argv.includes("--label")
  ? process.argv[process.argv.indexOf("--label") + 1] ?? "run"
  : "run";

const WIDTH = 8192;
const HEIGHT = 4096;
const DISPLAY_W = 1200;
const DISPLAY_H = 800;

function mockCanvas(): HTMLCanvasElement {
  let imageData: ImageData | null = null;
  const ctx = {
    createImageData(w: number, h: number): ImageData {
      imageData = {
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
        colorSpace: "srgb",
      } as ImageData;
      return imageData;
    },
    putImageData(data: ImageData): void {
      imageData = data;
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
  return canvas as unknown as HTMLCanvasElement;
}

async function main(): Promise<void> {
  const { renderImageToCanvas } = await import("../src/render.js");

  const data = new Float64Array(WIDTH * HEIGHT);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.sin(i * 0.001) * 100;
  }

  const plane = {
    data,
    shape: [HEIGHT, WIDTH],
    axes: { time: -1, band: -1, y: 0, x: 1 },
  };

  const options = {
    mode: "scalar" as const,
    rgbBands: [0, 1, 2] as [number, number, number],
    autoscale: true,
    attributes: {},
    flipY: false,
    colormap: "viridis",
  };

  const canvas = mockCanvas();
  renderImageToCanvas(canvas, plane, options);

  const runs = 3;
  const fullTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    renderImageToCanvas(canvas, plane, options);
    fullTimes.push(performance.now() - t0);
  }
  const fullMs = fullTimes.reduce((a, b) => a + b, 0) / runs;

  const dTimes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    renderImageToCanvas(canvas, plane, options, { width: DISPLAY_W, height: DISPLAY_H });
    dTimes.push(performance.now() - t0);
  }
  const displayMs = dTimes.reduce((a, b) => a + b, 0) / runs;

  console.log(
    JSON.stringify({
      label,
      plane: `${WIDTH}x${HEIGHT}`,
      display: `${DISPLAY_W}x${DISPLAY_H}`,
      canvasAfterDisplay: `${canvas.width}x${canvas.height}`,
      renderMsFull: Math.round(fullMs),
      renderMsDisplay: Math.round(displayMs),
      dataBytes: data.byteLength,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
