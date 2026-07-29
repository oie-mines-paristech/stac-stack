import type { SpatialChunkGrid } from "./chunk_plan.js";
import {
  geoToAxisIndex,
  longitudeSpan,
  normalizeLongitude,
  unwrapLongitude,
  type GeoPixelMapper,
} from "./spatial.js";

const COASTLINES_URL = `${import.meta.env?.BASE_URL ?? "/"}coastlines.svg`;
const MAX_JUMP_FRACTION = 0.4;
const GLOBAL_LON_SPAN = 350;

export interface WarpedPath {
  d: string;
}

export interface WarpPathOptions {
  xValues?: number[];
  maxJumpFraction?: number;
}

type PathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Z" };

let coastlinePathDsPromise: Promise<string[]> | null = null;

export function resetCoastlineCache(): void {
  coastlinePathDsPromise = null;
}

async function fetchCoastlinePathDs(): Promise<string[]> {
  const response = await fetch(COASTLINES_URL);
  if (!response.ok) {
    throw new Error(`Failed to load coastlines: ${response.status}`);
  }
  const text = await response.text();
  return extractCoastlinePathDs(text);
}

export function getCoastlinePathDs(): Promise<string[]> {
  if (!coastlinePathDsPromise) {
    coastlinePathDsPromise = fetchCoastlinePathDs();
  }
  return coastlinePathDsPromise;
}

/** Extract path `d` attributes from the #positioner group (lon/lat vertices). */
export function extractCoastlinePathDs(svgText: string): string[] {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const positioner = doc.getElementById("positioner");
    if (!positioner) return [];
    return Array.from(positioner.querySelectorAll("path"))
      .map((path) => path.getAttribute("d"))
      .filter((d): d is string => Boolean(d));
  }

  // Node fallback: coastline paths are the only <path> elements in the asset.
  const paths: string[] = [];
  const pathRe = /<path[^>]*\sd="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pathRe.exec(svgText)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

const PATH_TOKEN =
  /([MmLlHhVvZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;

/** Parse SVG path `d` into absolute lon/lat vertices (M, L, Z only). */
export function parsePathD(d: string): PathCommand[] {
  const tokens: Array<string> = [];
  let match: RegExpExecArray | null;
  PATH_TOKEN.lastIndex = 0;
  while ((match = PATH_TOKEN.exec(d)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }

  const commands: PathCommand[] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let cmd: string | null = null;

  const readNumber = (): number => {
    if (i >= tokens.length) return 0;
    return Number(tokens[i++]);
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[MLHVZmlhvz]$/.test(token)) {
      cmd = token;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }

    switch (cmd) {
      case "M":
        x = readNumber();
        y = readNumber();
        commands.push({ type: "M", x, y });
        cmd = "L";
        break;
      case "m":
        x += readNumber();
        y += readNumber();
        commands.push({ type: "M", x, y });
        cmd = "l";
        break;
      case "L":
        x = readNumber();
        y = readNumber();
        commands.push({ type: "L", x, y });
        break;
      case "l":
        x += readNumber();
        y += readNumber();
        commands.push({ type: "L", x, y });
        break;
      case "H":
        x = readNumber();
        commands.push({ type: "L", x, y });
        break;
      case "h":
        x += readNumber();
        commands.push({ type: "L", x, y });
        break;
      case "V":
        y = readNumber();
        commands.push({ type: "L", x, y });
        break;
      case "v":
        y += readNumber();
        commands.push({ type: "L", x, y });
        break;
      case "Z":
      case "z":
        commands.push({ type: "Z" });
        cmd = null;
        break;
      default:
        cmd = null;
        break;
    }
  }

  return commands;
}

function formatCoord(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function lonLatToPixel(
  lon: number,
  lat: number,
  mapper: GeoPixelMapper,
  xValues: number[] | undefined,
  prevLon: number | undefined,
  prevIdx: number | undefined,
): { px: number; py: number; idx: number | undefined } {
  const py = mapper.latToPixel(lat);

  if (!xValues || xValues.length <= 1) {
    return { px: mapper.lonToPixel(lon), py, idx: undefined };
  }

  const n = xValues.length;
  const globalGrid = longitudeSpan(xValues) >= GLOBAL_LON_SPAN;
  const normalized = normalizeLongitude(lon, xValues);
  let idx = geoToAxisIndex(xValues, normalized);

  if (globalGrid && prevLon !== undefined && prevIdx !== undefined) {
    const unwrapped = unwrapLongitude(lon, prevLon);
    let rawIdx = geoToAxisIndex(xValues, normalizeLongitude(unwrapped, xValues));
    while (rawIdx - prevIdx > n / 2) rawIdx -= n;
    while (rawIdx - prevIdx < -n / 2) rawIdx += n;
    idx = rawIdx;
  }

  const px = (idx * (mapper.width - 1)) / (n - 1);
  return { px, py, idx };
}

/** Warp a path from lon/lat to pixel (or chunk) coordinates. */
export function warpPathD(
  d: string,
  mapper: GeoPixelMapper,
  options?: WarpPathOptions,
): string {
  const commands = parsePathD(d);
  const parts: string[] = [];
  const maxJump = mapper.width * (options?.maxJumpFraction ?? MAX_JUMP_FRACTION);
  const xValues = options?.xValues;

  let prevLon: number | undefined;
  let prevPx: number | undefined;
  let prevIdx: number | undefined;

  for (const command of commands) {
    if (command.type === "Z") {
      parts.push("Z");
      prevLon = undefined;
      prevPx = undefined;
      prevIdx = undefined;
      continue;
    }

    const { px, py, idx } = lonLatToPixel(
      command.x,
      command.y,
      mapper,
      xValues,
      prevLon,
      prevIdx,
    );

    let cmdType = command.type;
    if (
      command.type === "L" &&
      prevPx !== undefined &&
      Math.abs(px - prevPx) > maxJump
    ) {
      cmdType = "M";
    }

    parts.push(`${cmdType}${formatCoord(px)} ${formatCoord(py)}`);
    prevLon = command.x;
    prevPx = px;
    prevIdx = idx;
  }

  return parts.join("");
}

export function warpCoastlinePathDs(
  pathDs: string[],
  mapper: GeoPixelMapper,
  xValues?: number[],
): WarpedPath[] {
  const options = xValues ? { xValues } : undefined;
  return pathDs.map((d) => ({ d: warpPathD(d, mapper, options) }));
}

export async function warpCoastlinePaths(
  mapper: GeoPixelMapper,
  xValues?: number[],
): Promise<WarpedPath[]> {
  const pathDs = await getCoastlinePathDs();
  return warpCoastlinePathDs(pathDs, mapper, xValues);
}

/** Map lon/lat to chunk-space; optional Y flip for north-up picker display. */
export function createChunkSpaceMapper(
  xValues: number[],
  yValues: number[],
  grid: SpatialChunkGrid,
  northUp = false,
): GeoPixelMapper {
  return {
    width: grid.xChunks,
    height: grid.yChunks,
    flipY: false,
    lonToPixel(lon: number): number {
      const normalized = normalizeLongitude(lon, xValues);
      return geoToAxisIndex(xValues, normalized) / grid.xChunkSize;
    },
    latToPixel(lat: number): number {
      const dataChunkY = geoToAxisIndex(yValues, lat) / grid.yChunkSize;
      return northUp ? grid.yChunks - dataChunkY : dataChunkY;
    },
  };
}

export async function warpCoastlinePathsToChunkSpace(
  xValues: number[],
  yValues: number[],
  grid: SpatialChunkGrid,
  northUp = false,
): Promise<WarpedPath[]> {
  const mapper = createChunkSpaceMapper(xValues, yValues, grid, northUp);
  return warpCoastlinePaths(mapper, xValues);
}
