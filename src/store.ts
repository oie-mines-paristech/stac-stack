import * as zarr from "zarrita";
import { registerJpegxlCodec } from "jpegxl-zarr";
import { buildDatasetSchema, type DatasetSchema, type ImageVariable } from "./dimensions.js";

export interface OpenDatasetResult {
  schema: DatasetSchema;
  store: Awaited<ReturnType<typeof zarr.withConsolidatedMetadata>>;
  root: ReturnType<
    typeof zarr.root<Awaited<ReturnType<typeof zarr.withConsolidatedMetadata>>>
  >;
}

let codecRegistered = false;
const byteCache = new Map<string, Uint8Array | undefined>();
const arrayCache = new Map<string, zarr.Array<zarr.DataType>>();

function ensureCodec(): void {
  if (!codecRegistered) {
    registerJpegxlCodec();
    codecRegistered = true;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadZarrJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(new URL("zarr.json", url));
  if (!response.ok) {
    throw new Error(`Failed to fetch zarr.json (${response.status})`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export function resetDatasetCaches(): void {
  byteCache.clear();
  arrayCache.clear();
}

export async function openDataset(url: string): Promise<OpenDatasetResult> {
  ensureCodec();
  resetDatasetCaches();
  const normalized = url.endsWith("/") ? url : `${url}/`;
  const zarrJson = await loadZarrJson(normalized);
  const rootAttributes = asRecord(zarrJson.attributes);
  const consolidated = asRecord(zarrJson.consolidated_metadata).metadata;
  if (!consolidated || typeof consolidated !== "object") {
    throw new Error("Store has no inline consolidated metadata in zarr.json");
  }

  const baseStore = new zarr.FetchStore(normalized);
  const cachedStore = zarr.withByteCaching(baseStore, { cache: byteCache });
  const store = await zarr.withConsolidatedMetadata(cachedStore);
  const root = zarr.root(store);
  const schema = buildDatasetSchema(
    normalized,
    consolidated as Record<string, unknown>,
    rootAttributes,
  );
  if (schema.variables.length === 0) {
    throw new Error("No image-like variables found in consolidated metadata");
  }
  return { schema, store, root };
}

export async function openVariableArray(
  root: OpenDatasetResult["root"],
  variable: ImageVariable,
): Promise<zarr.Array<zarr.DataType>> {
  ensureCodec();
  const cached = arrayCache.get(variable.path);
  if (cached) return cached;

  const node = await zarr.open(root.resolve(variable.path), { kind: "array" });
  if (!(node instanceof zarr.Array)) {
    throw new Error(`Expected array at ${variable.path}`);
  }
  arrayCache.set(variable.path, node);
  return node;
}

export async function readCoordinateValues(
  root: OpenDatasetResult["root"],
  coordPath: string,
): Promise<unknown[]> {
  ensureCodec();
  const arr = await zarr.open(root.resolve(coordPath), { kind: "array" });
  const chunk = await arr.getChunk([0]);
  const data = chunk.data as ArrayLike<number | bigint | string>;
  return Array.from(data as ArrayLike<unknown>);
}

export function shardSummary(variable: ImageVariable): string | undefined {
  const shards = variable.attributes.zarr_shards;
  if (!shards || typeof shards !== "object") return undefined;
  const time = (shards as Record<string, unknown>).time;
  if (time === 96) return "daily (96×15 min steps per shard)";
  if (typeof time === "number") return `time shard size ${time}`;
  return JSON.stringify(shards);
}
