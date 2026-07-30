import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChunkSpaceMapper,
  extractCoastlinePathDs,
  parsePathD,
  warpCoastlinePathDs,
  warpPathD,
} from "./coastline_warp.js";
import { createGeoPixelMapper } from "./spatial.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function approx(actual: number, expected: number, eps = 0.02): void {
  assert(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`);
}

const era5Lats = Array.from({ length: 721 }, (_, i) => 90 - (i * 180) / 720);
const era5Lons = Array.from({ length: 1440 }, (_, i) => (i * 360) / 1439);
const grid = {
  yChunks: 8,
  xChunks: 16,
  yChunkSize: 90,
  xChunkSize: 90,
  yAxisIndex: 0,
  xAxisIndex: 1,
  yAxisSize: 721,
  xAxisSize: 1440,
};
const chunkMapper = createChunkSpaceMapper(era5Lons, era5Lats, grid, false);
assert(
  chunkMapper.latToPixel(-35) > chunkMapper.latToPixel(42),
  "north-at-top grid: south maps below north",
);

const southFirstLats = Array.from({ length: 721 }, (_, i) => -90 + (i * 180) / 720);
const flippedMapper = createChunkSpaceMapper(era5Lons, southFirstLats, grid, true);
assert(
  flippedMapper.latToPixel(42) < flippedMapper.latToPixel(-35),
  "north-up picker flip: Mediterranean above South Africa",
);

const parsed = parsePathD("M10 20L30 40L50 60Z");
assert(parsed.length === 4, "parsePathD counts commands");
assert(parsed[0].type === "M" && (parsed[0] as { x: number }).x === 10, "parsePathD M");
assert(parsed[1].type === "L" && (parsed[1] as { x: number }).x === 30, "parsePathD L");
assert(parsed[3].type === "Z", "parsePathD Z");

const uniformLon = Array.from({ length: 361 }, (_, i) => i);
const uniformLat = Array.from({ length: 181 }, (_, i) => 90 - i);
const mapper = createGeoPixelMapper(uniformLon, uniformLat, false, 361, 181);

approx(mapper.lonToPixel(0), 0);
approx(mapper.lonToPixel(180), 180);
approx(mapper.latToPixel(90), 0);
approx(mapper.latToPixel(-90), 180);

const warped = warpPathD("M0 90L180 90L180 0Z", mapper);
assert(warped.startsWith("M"), "warpPathD keeps moveto");
assert(warped.includes("Z"), "warpPathD keeps close");

const pathDs = warpCoastlinePathDs(["M0 90L10 80Z"], mapper);
assert(pathDs.length === 1 && pathDs[0].d.length > 0, "warpCoastlinePathDs");

function maxLineHorizontalJump(d: string): number {
  const re = /([ML])(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let max = 0;
  let prevPx: number | undefined;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const cmd = match[1];
    const px = Number(match[2]);
    if (cmd === "L" && prevPx !== undefined) {
      max = Math.max(max, Math.abs(px - prevPx));
    }
    prevPx = px;
  }
  return max;
}

const ecmwfLons = Array.from({ length: 1440 }, (_, i) => -180 + (i * 360) / 1439);
const ecmwfLats = Array.from({ length: 721 }, (_, i) => 90 - (i * 180) / 720);
const ecmwfMapper = createGeoPixelMapper(ecmwfLons, ecmwfLats, false, 1440, 721);

const datelineWarped = warpPathD("M179 0L-179 0", ecmwfMapper, {
  xValues: ecmwfLons,
});
assert(
  maxLineHorizontalJump(datelineWarped) < ecmwfMapper.width * 0.4,
  "dateline warp avoids long horizontal segment on -180..180 grid",
);

const splitOnly = warpPathD("M179 0L-179 0", ecmwfMapper);
assert(
  maxLineHorizontalJump(splitOnly) < ecmwfMapper.width * 0.4,
  "dateline warp splits without xValues",
);

const era5Mapper = createGeoPixelMapper(era5Lons, era5Lats, false, 1440, 721);
const era5Dateline = warpPathD("M174 0L-178 0", era5Mapper, { xValues: era5Lons });
assert(
  era5Dateline.includes("L"),
  "0..360 grid keeps connected segment across dateline",
);
assert(
  maxLineHorizontalJump(era5Dateline) < 50,
  "0..360 dateline segment stays within pixel threshold",
);

const regionalWarped = warpPathD("M0 90L10 80", mapper, { xValues: uniformLon });
assert(regionalWarped.includes("L"), "regional segment stays connected");
assert(maxLineHorizontalJump(regionalWarped) < 20, "regional segment has small pixel jump");

const fixtureSvg = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g id="positioner">
    <path d="M0 0L1 1Z" />
    <path d="M2 2L3 3Z" />
  </g>
</svg>`;
const extracted = extractCoastlinePathDs(fixtureSvg);
assert(extracted.length === 2, "extractCoastlinePathDs finds positioner paths");
assert(extracted[0] === "M0 0L1 1Z", "extractCoastlinePathDs first path");

const here = dirname(fileURLToPath(import.meta.url));
const coastlinesSvg = readFileSync(join(here, "../public/coastlines.svg"), "utf8");
const allPaths = extractCoastlinePathDs(coastlinesSvg);
assert(allPaths.length === 243, "coastlines.svg path count");

console.log("coastline_warp.test.ts: ok");
