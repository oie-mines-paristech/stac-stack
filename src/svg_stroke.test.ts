import { strokeWidthForViewBox } from "./ui/svg_stroke.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(strokeWidthForViewBox(8000, 800, 1) === 10, "4K viewBox at 800px display → 10 user units");
assert(strokeWidthForViewBox(361, 361, 1) === 1, "1:1 display keeps 1 user unit");
assert(strokeWidthForViewBox(16, 320, 1.25) === 0.0625, "chunk picker stroke scales down");

console.log("svg_stroke.test.ts: ok");
