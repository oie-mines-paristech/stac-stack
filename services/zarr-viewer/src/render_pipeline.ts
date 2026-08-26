import { DEFAULT_COLORMAP, getColormapLut } from "./colormap.js";
import type { PlaneDtypeTag } from "./chunk_utils.js";
import {
  putRgbaOnCanvas2d,
  renderRgbRegionToRgba,
  renderScalarRegionToRgba,
} from "./render_core.js";
import type { ImagePlane, RenderOptions, RenderResult } from "./render.js";
import { resolveChannelRangeTuples } from "./render.js";
import { renderInWorker, renderWorkerAvailable, planeDtype } from "./render_worker_client.js";
import { WebGLPlaneRenderer } from "./render_webgl.js";
import type { ViewLayout } from "./view_transform.js";

let webglRenderer: WebGLPlaneRenderer | null = null;
let webglCanvas: HTMLCanvasElement | null = null;

function ensureWebGLRenderer(canvas: HTMLCanvasElement): WebGLPlaneRenderer | null {
  if (webglRenderer && webglCanvas === canvas) return webglRenderer;
  webglRenderer = WebGLPlaneRenderer.tryCreate(canvas);
  webglCanvas = webglRenderer ? canvas : null;
  return webglRenderer;
}

function drawRgba(
  canvas: HTMLCanvasElement,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  preferWebGL: boolean,
): "webgl" | "canvas2d" {
  if (preferWebGL) {
    const renderer = ensureWebGLRenderer(canvas);
    if (renderer) {
      renderer.draw(rgba, width, height);
      return "webgl";
    }
  }
  putRgbaOnCanvas2d(canvas, rgba, width, height);
  return "canvas2d";
}

export interface RenderPipelineResult extends RenderResult {
  backend: "worker-webgl" | "worker-canvas2d" | "main-webgl" | "main-canvas2d";
}

export interface RenderPipelineOptions {
  preferWebGL?: boolean;
  preferWorker?: boolean;
  dtype?: string;
  channelRanges?: Array<[number, number]>;
}

export async function renderPlaneToView(
  canvas: HTMLCanvasElement,
  plane: ImagePlane,
  options: RenderOptions,
  layout: ViewLayout,
  pipelineOptions?: RenderPipelineOptions,
): Promise<RenderPipelineResult> {
  const { data, shape, axes } = plane;
  const planeHeight = shape[axes.y]!;
  const planeWidth = shape[axes.x]!;
  const displayTransform = layout.displayTransform;
  const preferWebGL = pipelineOptions?.preferWebGL ?? true;
  const preferWorker = pipelineOptions?.preferWorker ?? true;
  const dtype = pipelineOptions?.dtype ?? "float64";

  if (
    !Number.isFinite(planeHeight) ||
    !Number.isFinite(planeWidth) ||
    planeHeight <= 0 ||
    planeWidth <= 0
  ) {
    return { scaleMin: 0, scaleMax: 1, displayTransform, backend: "main-canvas2d" };
  }

  const flipY = options.flipY ?? false;
  const bandCount = axes.band >= 0 ? shape[axes.band]! : 1;
  const { region, target } = layout;
  const planeDtypeTag: PlaneDtypeTag = planeDtype(data);
  const ranges =
    pipelineOptions?.channelRanges ?? resolveChannelRangeTuples(plane, options, dtype, plane.bandStats);

  if (options.mode === "scalar" || bandCount === 1) {
    const [min, max] = ranges[0] ?? [0, 1];
    const lut = getColormapLut(options.colormap ?? DEFAULT_COLORMAP);

    if (preferWorker && renderWorkerAvailable()) {
      const response = await renderInWorker({
        id: 0,
        kind: "scalar",
        buffer: data.buffer.slice(0),
        planeWidth,
        planeHeight,
        shape,
        axes,
        region,
        target,
        min,
        max,
        lut,
        flipY,
        dtype: planeDtypeTag,
      });
      const backendKind = drawRgba(
        canvas,
        response.rgba,
        response.width,
        response.height,
        preferWebGL,
      );
      return {
        scaleMin: min,
        scaleMax: max,
        displayTransform,
        backend: backendKind === "webgl" ? "worker-webgl" : "worker-canvas2d",
      };
    }

    const rgba = renderScalarRegionToRgba({
      data,
      planeWidth,
      planeHeight,
      shape,
      axes,
      region,
      target,
      min,
      max,
      lut,
      flipY,
    });
    const backendKind = drawRgba(canvas, rgba, target.width, target.height, preferWebGL);
    return {
      scaleMin: min,
      scaleMax: max,
      displayTransform,
      backend: backendKind === "webgl" ? "main-webgl" : "main-canvas2d",
    };
  }

  const bandIndices = options.rgbBands;
  const rgba = renderRgbRegionToRgba({
    data,
    planeWidth,
    planeHeight,
    shape,
    axes,
    region,
    target,
    bandIndices,
    ranges,
    flipY,
  });
  const backendKind = drawRgba(canvas, rgba, target.width, target.height, preferWebGL);
  const scaleMin = Math.min(...ranges.map(([min]) => min));
  const scaleMax = Math.max(...ranges.map(([, max]) => max));
  return {
    scaleMin,
    scaleMax,
    displayTransform,
    backend: backendKind === "webgl" ? "main-webgl" : "main-canvas2d",
  };
}

export function resetRenderPipeline(): void {
  webglRenderer = null;
  webglCanvas = null;
}
