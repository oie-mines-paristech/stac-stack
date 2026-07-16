export type AxisRole = "time" | "x" | "y" | "band" | "other";

export interface CoordinateMeta {
  path: string;
  dimensionNames: string[];
  attributes: Record<string, unknown>;
  labels?: string[];
}

export interface AxisInfo {
  name: string;
  role: AxisRole;
  size: number;
  index: number;
  coordinate?: CoordinateMeta;
}

export interface ImageVariable {
  path: string;
  shape: number[];
  dimensionNames: string[];
  axes: AxisInfo[];
  attributes: Record<string, unknown>;
  dtype: string;
}

export interface DatasetSchema {
  url: string;
  rootAttributes: Record<string, unknown>;
  variables: ImageVariable[];
  coordinates: Record<string, CoordinateMeta>;
}

const TIME_UNITS = /\ssince\s/i;
const SPATIAL_X_NAMES = new Set([
  "projection_x_coordinate",
  "longitude",
  "x",
  "raw_x",
  "column",
]);
const SPATIAL_Y_NAMES = new Set([
  "projection_y_coordinate",
  "latitude",
  "y",
  "raw_y",
  "row",
]);
const BAND_NAMES = new Set(["band", "channel", "wavelength", "c"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isTimeCoord(attrs: Record<string, unknown>): boolean {
  if (attrs.standard_name === "time") return true;
  const units = attrs.units;
  return typeof units === "string" && TIME_UNITS.test(units);
}

function isSpatialXCoord(name: string, attrs: Record<string, unknown>): boolean {
  if (attrs.axis === "X") return true;
  if (typeof attrs.standard_name === "string" && SPATIAL_X_NAMES.has(attrs.standard_name))
    return true;
  return SPATIAL_X_NAMES.has(name.toLowerCase()) || name.endsWith("_x") || name === "x";
}

function isSpatialYCoord(name: string, attrs: Record<string, unknown>): boolean {
  if (attrs.axis === "Y") return true;
  if (typeof attrs.standard_name === "string" && SPATIAL_Y_NAMES.has(attrs.standard_name))
    return true;
  return SPATIAL_Y_NAMES.has(name.toLowerCase()) || name.endsWith("_y") || name === "y";
}

function isBandCoord(name: string, attrs: Record<string, unknown>): boolean {
  if (Array.isArray(attrs.names) || Array.isArray(attrs.flag_meanings)) return true;
  return BAND_NAMES.has(name.toLowerCase());
}

function bandLabels(attrs: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(attrs.names)) {
    return attrs.names.map(String);
  }
  if (typeof attrs.flag_meanings === "string") {
    return attrs.flag_meanings.split(/\s+/);
  }
  return undefined;
}

function classifyCoord(name: string, attrs: Record<string, unknown>): AxisRole {
  if (isTimeCoord(attrs)) return "time";
  if (isBandCoord(name, attrs)) return "band";
  if (isSpatialXCoord(name, attrs)) return "x";
  if (isSpatialYCoord(name, attrs)) return "y";
  return "other";
}

function classifyDimByName(name: string): AxisRole | null {
  const lower = name.toLowerCase();
  if (lower === "time" || lower === "t") return "time";
  if (BAND_NAMES.has(lower) || lower.startsWith("band")) return "band";
  if (lower === "x" || lower.endsWith("_x") || lower === "raw_x") return "x";
  if (lower === "y" || lower.endsWith("_y") || lower === "raw_y") return "y";
  return null;
}

function isImageVariable(meta: {
  shape: number[];
  dimension_names?: string[];
  dimensionNames?: string[];
  node_type?: string;
}): boolean {
  if (meta.node_type && meta.node_type !== "array") return false;
  if (!meta.shape || meta.shape.length < 2) return false;
  const names = meta.dimension_names ?? meta.dimensionNames ?? [];
  const hasSpatial =
    names.some((n) => classifyDimByName(n) === "x") &&
    names.some((n) => classifyDimByName(n) === "y");
  return hasSpatial;
}

export function buildDatasetSchema(
  url: string,
  consolidated: Record<string, unknown>,
  rootAttributes: Record<string, unknown> = {},
): DatasetSchema {
  const coordinates: Record<string, CoordinateMeta> = {};

  for (const [path, raw] of Object.entries(consolidated)) {
    const meta = asRecord(raw);
    const shape = meta.shape;
    if (!Array.isArray(shape) || shape.length !== 1) continue;
    const dimensionNames = (meta.dimension_names as string[] | undefined) ?? [path];
    const attributes = asRecord(meta.attributes);
    coordinates[path] = {
      path,
      dimensionNames,
      attributes,
      labels: bandLabels(attributes),
    };
  }

  const variables: ImageVariable[] = [];

  for (const [path, raw] of Object.entries(consolidated)) {
    const meta = asRecord(raw);
    if (!isImageVariable(meta as { shape: number[]; dimensionNames?: string[]; node_type?: string }))
      continue;

    const shape = meta.shape as number[];
    const dimensionNames = (meta.dimension_names as string[]) ?? shape.map((_, i) => `dim_${i}`);
    const attributes = asRecord(meta.attributes);
    const dtype = String(meta.data_type ?? "unknown");

    const axes: AxisInfo[] = dimensionNames.map((name, index) => {
      const coord = coordinates[name];
      let role: AxisRole = "other";
      if (coord) {
        role = classifyCoord(name, coord.attributes);
      } else {
        role = classifyDimByName(name) ?? "other";
      }
      return {
        name,
        role,
        size: shape[index],
        index,
        coordinate: coord,
      };
    });

    variables.push({ path, shape, dimensionNames, axes, attributes, dtype });
  }

  variables.sort((a, b) => a.path.localeCompare(b.path));
  return { url, rootAttributes, variables, coordinates };
}

export function axisByRole(variable: ImageVariable, role: AxisRole): AxisInfo | undefined {
  return variable.axes.find((axis) => axis.role === role);
}

export function otherAxes(variable: ImageVariable): AxisInfo[] {
  return variable.axes.filter(
    (axis) => !["time", "x", "y", "band"].includes(axis.role),
  );
}
