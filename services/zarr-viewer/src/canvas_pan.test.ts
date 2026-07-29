import { isCanvasPannable } from "./ui/canvas_pan.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const wrap = {
  clientWidth: 800,
  clientHeight: 600,
} as HTMLElement;

const canvas = {
  offsetWidth: 4096,
  offsetHeight: 2048,
} as HTMLCanvasElement;

assert(isCanvasPannable(wrap, canvas, true), "native oversized canvas is pannable");
assert(!isCanvasPannable(wrap, canvas, false), "fit-to-view is not pannable");

const smallCanvas = { offsetWidth: 400, offsetHeight: 300 } as HTMLCanvasElement;
assert(!isCanvasPannable(wrap, smallCanvas, true), "native canvas that fits is not pannable");

console.log("canvas_pan.test.ts: ok");
