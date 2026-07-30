/**
 * Builds a small Sophia-like Zarr v2 store for local e2e tests.
 * Same variable names and dimension layout as the real dataset, but tiny arrays
 * with synthetic gradient data and a central NaN patch.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(import.meta.dirname, "../public/fixtures/mini-sophia.zarr");

const TIME = 24;
const BAND = 4;
const Y = 32;
const X = 32;

const TIME_EPOCH = "2024-06-16 00:00:00";

type Zarray = {
  zarr_format: 2;
  shape: number[];
  chunks: number[];
  dtype: string;
  compressor: null;
  fill_value: null;
  order: "C";
  filters: null;
};

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeArray(
  baseDir: string,
  name: string,
  shape: number[],
  dtype: "<f4" | "<f8",
  data: Float32Array | Float64Array,
  attrs: Record<string, unknown>,
): void {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });

  const zarray: Zarray = {
    zarr_format: 2,
    shape,
    chunks: shape,
    dtype,
    compressor: null,
    fill_value: null,
    order: "C",
    filters: null,
  };

  writeJson(join(dir, ".zarray"), zarray);
  writeJson(join(dir, ".zattrs"), {
    _ARRAY_DIMENSIONS: shape.length === 1 ? [name] : attrs._ARRAY_DIMENSIONS,
    ...Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "_ARRAY_DIMENSIONS")),
  });

  const chunkKey = shape.map(() => "0").join(".");
  writeFileSync(join(dir, chunkKey), Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

function gradient4d(t: number, b: number, y: number, x: number): number {
  const nanCenter =
    y >= Math.floor(Y / 2) - 2 &&
    y <= Math.floor(Y / 2) + 2 &&
    x >= Math.floor(X / 2) - 2 &&
    x <= Math.floor(X / 2) + 2;
  if (nanCenter) return Number.NaN;
  return t * 10 + b * 100 + y * 0.5 + x * 0.1;
}

function gradient3d(b: number, y: number, x: number): number {
  return b * 50 + y * 0.3 + x * 0.2;
}

function fill4d(fn: (t: number, b: number, y: number, x: number) => number): Float32Array {
  const data = new Float32Array(TIME * BAND * Y * X);
  let index = 0;
  for (let t = 0; t < TIME; t++) {
    for (let b = 0; b < BAND; b++) {
      for (let y = 0; y < Y; y++) {
        for (let x = 0; x < X; x++) {
          data[index++] = fn(t, b, y, x);
        }
      }
    }
  }
  return data;
}

function fill3d(fn: (b: number, y: number, x: number) => number): Float32Array {
  const data = new Float32Array(BAND * Y * X);
  let index = 0;
  for (let b = 0; b < BAND; b++) {
    for (let y = 0; y < Y; y++) {
      for (let x = 0; x < X; x++) {
        data[index++] = fn(b, y, x);
      }
    }
  }
  return data;
}

function buildTimeCoord(): Float64Array {
  const data = new Float64Array(TIME);
  for (let index = 0; index < TIME; index++) {
    data[index] = index * 3600;
  }
  return data;
}

function buildBandCoord(): Float32Array {
  return new Float32Array([0, 1, 2, 3]);
}

function buildYCoord(): Float32Array {
  const data = new Float32Array(Y);
  for (let index = 0; index < Y; index++) {
    data[index] = 48 + index * 0.05;
  }
  return data;
}

function buildXCoord(): Float32Array {
  const data = new Float32Array(X);
  for (let index = 0; index < X; index++) {
    data[index] = 2 + index * 0.05;
  }
  return data;
}

function buildZmetadata(): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ".zattrs": { Conventions: "CF-1.8" },
    ".zgroup": { zarr_format: 2 },
  };

  const entries: Array<[string, Zarray, Record<string, unknown>]> = [
    [
      "time",
      { zarr_format: 2, shape: [TIME], chunks: [TIME], dtype: "<f8", compressor: null, fill_value: null, order: "C", filters: null },
      {
        standard_name: "time",
        units: `seconds since ${TIME_EPOCH}`,
        calendar: "proleptic_gregorian",
      },
    ],
    [
      "band",
      { zarr_format: 2, shape: [BAND], chunks: [BAND], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { names: ["R", "G1", "B", "G2"] },
    ],
    [
      "y",
      { zarr_format: 2, shape: [Y], chunks: [Y], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { standard_name: "projection_y_coordinate", units: "1" },
    ],
    [
      "x",
      { zarr_format: 2, shape: [X], chunks: [X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { standard_name: "projection_x_coordinate", units: "1" },
    ],
    [
      "azimuth",
      { zarr_format: 2, shape: [BAND, Y, X], chunks: [BAND, Y, X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { _ARRAY_DIMENSIONS: ["band", "y", "x"], units: "degree" },
    ],
    [
      "mask",
      { zarr_format: 2, shape: [BAND, Y, X], chunks: [BAND, Y, X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { _ARRAY_DIMENSIONS: ["band", "y", "x"] },
    ],
    [
      "overexposure_mask",
      { zarr_format: 2, shape: [TIME, BAND, Y, X], chunks: [TIME, BAND, Y, X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { _ARRAY_DIMENSIONS: ["time", "band", "y", "x"] },
    ],
    [
      "radiance",
      { zarr_format: 2, shape: [TIME, BAND, Y, X], chunks: [TIME, BAND, Y, X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { _ARRAY_DIMENSIONS: ["time", "band", "y", "x"], units: "W m-2 sr-1 nm-1" },
    ],
    [
      "underexposure_mask",
      { zarr_format: 2, shape: [TIME, BAND, Y, X], chunks: [TIME, BAND, Y, X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { _ARRAY_DIMENSIONS: ["time", "band", "y", "x"] },
    ],
    [
      "zenith",
      { zarr_format: 2, shape: [BAND, Y, X], chunks: [BAND, Y, X], dtype: "<f4", compressor: null, fill_value: null, order: "C", filters: null },
      { _ARRAY_DIMENSIONS: ["band", "y", "x"], units: "degree" },
    ],
  ];

  for (const [path, zarray, attrs] of entries) {
    metadata[`${path}/.zarray`] = zarray;
    metadata[`${path}/.zattrs`] = {
      _ARRAY_DIMENSIONS: attrs._ARRAY_DIMENSIONS ?? [path],
      ...Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "_ARRAY_DIMENSIONS")),
    };
  }

  return { metadata, zarr_consolidated_format: 1 as const };
}

function main(): void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  writeJson(join(OUT_DIR, ".zgroup"), { zarr_format: 2 });
  writeJson(join(OUT_DIR, ".zattrs"), { Conventions: "CF-1.8" });
  writeJson(join(OUT_DIR, ".zmetadata"), buildZmetadata());

  writeArray(join(OUT_DIR), "time", [TIME], "<f8", buildTimeCoord(), {
    standard_name: "time",
    units: `seconds since ${TIME_EPOCH}`,
    calendar: "proleptic_gregorian",
  });
  writeArray(join(OUT_DIR), "band", [BAND], "<f4", buildBandCoord(), {
    names: ["R", "G1", "B", "G2"],
  });
  writeArray(join(OUT_DIR), "y", [Y], "<f4", buildYCoord(), {
    standard_name: "projection_y_coordinate",
    units: "1",
  });
  writeArray(join(OUT_DIR), "x", [X], "<f4", buildXCoord(), {
    standard_name: "projection_x_coordinate",
    units: "1",
  });

  writeArray(
    join(OUT_DIR),
    "azimuth",
    [BAND, Y, X],
    "<f4",
    fill3d(gradient3d),
    { _ARRAY_DIMENSIONS: ["band", "y", "x"], units: "degree" },
  );
  writeArray(
    join(OUT_DIR),
    "mask",
    [BAND, Y, X],
    "<f4",
    fill3d((_b, y, x) => (y + x) % 2),
    { _ARRAY_DIMENSIONS: ["band", "y", "x"] },
  );
  writeArray(
    join(OUT_DIR),
    "overexposure_mask",
    [TIME, BAND, Y, X],
    "<f4",
    fill4d((t, b, y, x) => gradient4d(t, b, y, x) * 0.01),
    { _ARRAY_DIMENSIONS: ["time", "band", "y", "x"] },
  );
  writeArray(
    join(OUT_DIR),
    "radiance",
    [TIME, BAND, Y, X],
    "<f4",
    fill4d(gradient4d),
    { _ARRAY_DIMENSIONS: ["time", "band", "y", "x"], units: "W m-2 sr-1 nm-1" },
  );
  writeArray(
    join(OUT_DIR),
    "underexposure_mask",
    [TIME, BAND, Y, X],
    "<f4",
    fill4d((t, b, y, x) => (gradient4d(t, b, y, x) > 500 ? 1 : 0)),
    { _ARRAY_DIMENSIONS: ["time", "band", "y", "x"] },
  );
  writeArray(
    join(OUT_DIR),
    "zenith",
    [BAND, Y, X],
    "<f4",
    fill3d((_b, y, x) => 45 + y * 0.1 + x * 0.05),
    { _ARRAY_DIMENSIONS: ["band", "y", "x"], units: "degree" },
  );

  console.log(`e2e fixture written to ${OUT_DIR}`);
}

main();
