import type { SpatialChunkGrid } from "./chunk_plan.js";
import { geoToAxisIndex, normalizeLongitude, type GeoPixelMapper } from "./spatial.js";

const COASTLINES_URL = `${import.meta.env?.BASE_URL ?? "/"}coastlines.svg`;

export interface WarpedPath {
  d: string;
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

/** Warp a path from lon/lat to pixel (or chunk) coordinates. */
export function warpPathD(d: string, mapper: GeoPixelMapper): string {
  const commands = parsePathD(d);
  const parts: string[] = [];

  for (const command of commands) {
    if (command.type === "Z") {
      parts.push("Z");
      continue;
    }
    const px = mapper.lonToPixel(command.x);
    const py = mapper.latToPixel(command.y);
    parts.push(`${command.type}${formatCoord(px)} ${formatCoord(py)}`);
  }

  return parts.join("");
}

export function warpCoastlinePathDs(
  pathDs: string[],
  mapper: GeoPixelMapper,
): WarpedPath[] {
  return pathDs.map((d) => ({ d: warpPathD(d, mapper) }));
}

export async function warpCoastlinePaths(
  mapper: GeoPixelMapper,
): Promise<WarpedPath[]> {
  const pathDs = await getCoastlinePathDs();
  return warpCoastlinePathDs(pathDs, mapper);
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
  return warpCoastlinePaths(mapper);
}
