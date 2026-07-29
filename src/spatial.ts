export function shouldFlipYAxis(
  yValues: number[] | null,
  coordAttrs: Record<string, unknown> = {},
): boolean {
  const stored = coordAttrs.stored_direction;
  if (stored === "decreasing" || stored === "increasing") {
    if (yValues && yValues.length >= 2) {
      const valuesIncreasing = yValues[0] < yValues.at(-1)!;
      if (stored === "decreasing" && valuesIncreasing) return true;
      if (stored === "increasing" && !valuesIncreasing) return true;
      return false;
    }
    return stored === "increasing";
  }

  if (!yValues || yValues.length < 2) return false;
  return yValues[0] < yValues.at(-1)!;
}

export function displayRow(dataY: number, height: number, flipY: boolean): number {
  return flipY ? height - 1 - dataY : dataY;
}

export function dataRowFromCanvas(canvasY: number, height: number, flipY: boolean): number {
  return flipY ? height - 1 - canvasY : canvasY;
}

const LAT_NAMES = new Set(["latitude", "lat"]);
const LON_NAMES = new Set(["longitude", "lon"]);

export function isLatLonVariable(variable: {
  axes: Array<{ name: string; role: string }>;
}): boolean {
  const x = variable.axes.find((axis) => axis.role === "x");
  const y = variable.axes.find((axis) => axis.role === "y");
  if (!x || !y) return false;
  return LON_NAMES.has(x.name.toLowerCase()) && LAT_NAMES.has(y.name.toLowerCase());
}

export function isRectilinearGrid(variable: {
  attributes: Record<string, unknown>;
}): boolean {
  const gridType = variable.attributes.GRIB_gridType;
  if (typeof gridType === "string" && gridType.toLowerCase() === "healpix") {
    return false;
  }
  return true;
}

export function canShowCoastlines(variable: {
  axes: Array<{ name: string; role: string }>;
  attributes: Record<string, unknown>;
}): boolean {
  return isLatLonVariable(variable);
}

/** Map a geographic coordinate to a fractional index along a 1D axis (O(log n)). */
export function geoToAxisIndex(values: number[], coord: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return 0;

  const increasing = values[0] <= values[n - 1];
  const min = Math.min(values[0], values[n - 1]);
  const max = Math.max(values[0], values[n - 1]);

  if (increasing) {
    if (coord <= min) return 0;
    if (coord >= max) return n - 1;
  } else {
    if (coord >= max) return 0;
    if (coord <= min) return n - 1;
  }

  let lo = 0;
  let hi = n - 1;

  if (increasing) {
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= coord) lo = mid;
      else hi = mid;
    }
    const delta = values[lo + 1] - values[lo];
    if (delta === 0) return lo;
    return lo + (coord - values[lo]) / delta;
  }

  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid] >= coord) lo = mid;
    else hi = mid;
  }
  const delta = values[lo] - values[lo + 1];
  if (delta === 0) return lo;
  return lo + (values[lo] - coord) / delta;
}

/** Wrap longitude into the interval spanned by xValues (handles 0–360 vs −180–180). */
export function normalizeLongitude(lon: number, xValues: number[]): number {
  const n = xValues.length;
  if (n < 2) return lon;
  const lonMin = Math.min(xValues[0], xValues[n - 1]);
  const lonMax = Math.max(xValues[0], xValues[n - 1]);
  const span = lonMax - lonMin;
  if (span < 350) return lon;

  let normalized = lon;
  while (normalized < lonMin) normalized += 360;
  while (normalized > lonMax) normalized -= 360;
  return normalized;
}

/** Pick the longitude representative closest to prevLon (for dateline-crossing segments). */
export function unwrapLongitude(lon: number, prevLon: number): number {
  let adjusted = lon;
  while (adjusted - prevLon > 180) adjusted -= 360;
  while (adjusted - prevLon < -180) adjusted += 360;
  return adjusted;
}

export function longitudeSpan(xValues: number[]): number {
  if (xValues.length < 2) return 0;
  return Math.abs(xValues[xValues.length - 1]! - xValues[0]!);
}

export interface GeoPixelMapper {
  width: number;
  height: number;
  flipY: boolean;
  lonToPixel(lon: number): number;
  latToPixel(lat: number): number;
}

export function createGeoPixelMapper(
  xValues: number[],
  yValues: number[],
  flipY: boolean,
  width: number,
  height: number,
): GeoPixelMapper {
  return {
    width,
    height,
    flipY,
    lonToPixel(lon: number): number {
      const normalized = normalizeLongitude(lon, xValues);
      const idx = geoToAxisIndex(xValues, normalized);
      if (xValues.length <= 1) return 0;
      return (idx * (width - 1)) / (xValues.length - 1);
    },
    latToPixel(lat: number): number {
      const idx = geoToAxisIndex(yValues, lat);
      const scaled =
        yValues.length <= 1 ? 0 : (idx * (height - 1)) / (yValues.length - 1);
      return flipY ? height - 1 - scaled : scaled;
    },
  };
}

export function spatialCoordsMatchPlane(
  spatial: { xValues: number[] | null; yValues: number[] | null },
  planeWidth: number,
  planeHeight: number,
): boolean {
  if (!spatial.xValues?.length || !spatial.yValues?.length) return false;
  return spatial.xValues.length === planeWidth && spatial.yValues.length === planeHeight;
}

export interface CoastlineLayout {
  viewBox: string;
  /** Shift applied after the positioner transform (0–360° grids need +180). */
  shiftX: number;
  /** Flip overlay vertically to match canvas when south is at the top. */
  flipY: boolean;
}

export function coastlineLayout(spatial: {
  xValues: number[];
  yValues: number[];
  flipY: boolean;
}): CoastlineLayout {
  const lons = spatial.xValues;
  const lats = spatial.yValues;
  const lonStart = lons[0];
  const lonEnd = lons.at(-1)!;
  let lonMin = Math.min(lonStart, lonEnd);
  let lonMax = Math.max(lonStart, lonEnd);

  const latStart = lats[0];
  const latEnd = lats.at(-1)!;
  const canvasTopLat = spatial.flipY ? latEnd : latStart;
  const canvasBottomLat = spatial.flipY ? latStart : latEnd;
  const latNorth = Math.max(canvasTopLat, canvasBottomLat);
  const latSouth = Math.min(canvasTopLat, canvasBottomLat);

  const uses0360 = lonMin >= 0 && lonMax > 180;

  let viewBoxX: number;
  let viewBoxWidth: number;
  let shiftX: number;

  if (uses0360) {
    viewBoxX = lonMin;
    viewBoxWidth = lonMax - lonMin;
    shiftX = 180;
  } else if (lonMax - lonMin > 350 && lonMin < 0) {
    viewBoxX = 0;
    viewBoxWidth = 360;
    shiftX = 0;
  } else {
    viewBoxX = lonMin + 180;
    viewBoxWidth = lonMax - lonMin;
    shiftX = 0;
  }

  const y = 90 - latNorth;
  const height = Math.max(latNorth - latSouth, 0.25);
  viewBoxWidth = Math.max(viewBoxWidth, 0.25);

  return {
    viewBox: `${viewBoxX} ${y} ${viewBoxWidth} ${height}`,
    shiftX,
    flipY: canvasTopLat < canvasBottomLat,
  };
}
