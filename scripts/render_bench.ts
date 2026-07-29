/**
 * Render benchmark: synthetic 8192×4096 plane (scalar).
 *
 * Usage:
 *   npx tsx scripts/render_bench.ts [--label run]
 *   npx tsx scripts/render_bench.ts --phase all
 */
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const label = process.argv.includes("--label")
  ? process.argv[process.argv.indexOf("--label") + 1] ?? "run"
  : "run";
const phaseArg = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1] ?? "all"
  : "all";

const WIDTH = 8192;
const HEIGHT = 4096;
const DISPLAY_W = 1200;
const DISPLAY_H = 800;
const RUNS = 3;

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

function average(times: number[]): number {
  return times.reduce((a, b) => a + b, 0) / times.length;
}

async function benchSync(
  renderImageToCanvas: typeof import("../src/render.js").renderImageToCanvas,
  plane: Parameters<typeof renderImageToCanvas>[1],
  options: Parameters<typeof renderImageToCanvas>[2],
  canvas: HTMLCanvasElement,
  layoutInput?: import("../src/render.js").RenderLayoutInput,
): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    renderImageToCanvas(canvas, plane, options, layoutInput);
    times.push(performance.now() - t0);
  }
  return average(times);
}

async function benchCoreVisible(
  renderScalarRegionToRgba: typeof import("../src/render_core.js").renderScalarRegionToRgba,
  getColormapLut: typeof import("../src/colormap.js").getColormapLut,
  data: Float64Array,
): Promise<number> {
  const lut = getColormapLut("viridis");
  const region = { x0: 0, y0: 0, width: DISPLAY_W, height: DISPLAY_H };
  const target = { width: DISPLAY_W, height: DISPLAY_H };
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    renderScalarRegionToRgba({
      data,
      planeWidth: WIDTH,
      planeHeight: HEIGHT,
      shape: [HEIGHT, WIDTH],
      axes: { time: -1, band: -1, y: 0, x: 1 } as { x: number; y: number; band: number },
      region,
      target,
      min: -100,
      max: 100,
      lut,
      flipY: false,
    });
    times.push(performance.now() - t0);
  }
  return average(times);
}

async function benchWorkerVisible(): Promise<number> {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "render_worker_bench.ts");
  const payload = JSON.stringify({
    planeWidth: WIDTH,
    planeHeight: HEIGHT,
    regionWidth: DISPLAY_W,
    regionHeight: DISPLAY_H,
  });

  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const result = spawnSync("npx", ["tsx", scriptPath, payload], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || "Worker subprocess failed");
    }
    times.push(Number(result.stdout.trim()));
  }
  return average(times);
}

async function main(): Promise<void> {
  const { renderImageToCanvas } = await import("../src/render.js");
  const { renderScalarRegionToRgba } = await import("../src/render_core.js");
  const { getColormapLut } = await import("../src/colormap.js");
  const { arrayMinMax } = await import("../src/scaling.js");

  const data = new Float64Array(WIDTH * HEIGHT);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.sin(i * 0.001) * 100;
  }
  const [min, max] = arrayMinMax(data);

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
  const results: Record<string, number | string | null> = {};

  const phases =
    phaseArg === "all"
      ? ["phase1-full", "phase1-display", "phase2-visible", "phase2-core", "phase2-worker"]
      : [phaseArg];

  if (phases.includes("phase1-full")) {
    results.renderMsPhase1Full = Math.round(
      await benchSync(renderImageToCanvas, plane, options, canvas),
    );
  }

  if (phases.includes("phase1-display")) {
    results.renderMsPhase1Display = Math.round(
      await benchSync(renderImageToCanvas, plane, options, canvas, {
        viewportWidth: DISPLAY_W,
        viewportHeight: DISPLAY_H,
        fillView: true,
      }),
    );
  }

  if (phases.includes("phase2-visible")) {
    results.renderMsPhase2Visible = Math.round(
      await benchSync(renderImageToCanvas, plane, options, canvas, {
        viewportWidth: DISPLAY_W,
        viewportHeight: DISPLAY_H,
        fillView: false,
        viewOrigin: { x: 0, y: 0 },
      }),
    );
  }

  if (phases.includes("phase2-core")) {
    results.renderMsPhase2Core = Math.round(await benchCoreVisible(renderScalarRegionToRgba, getColormapLut, data));
  }

  if (phases.includes("phase2-worker")) {
    try {
      const workerMs = await benchWorkerVisible();
      results.renderMsPhase2Worker = Math.round(workerMs);
    } catch (error) {
      results.renderMsPhase2Worker = null;
      results.workerBenchError = error instanceof Error ? error.message : String(error);
    }
  }

  console.log(
    JSON.stringify({
      label,
      plane: `${WIDTH}x${HEIGHT}`,
      viewport: `${DISPLAY_W}x${DISPLAY_H}`,
      scaleMin: min,
      scaleMax: max,
      dataBytes: data.byteLength,
      ...results,
      note: "WebGL display is browser-only. phase2-worker runs colormap in an isolated subprocess (proxy for browser worker).",
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
