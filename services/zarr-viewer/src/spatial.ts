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
