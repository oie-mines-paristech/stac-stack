import * as zarr from "zarrita";
import { registerJpegxlCodec } from "@oie-minesparis-psl/jpegxl-zarr";
import type { StoreAuth } from "./auth.js";
import { createAuthFetch, storeUrlForFetch } from "./auth.js";
import {
  normalizeV2Consolidated,
  normalizeV3Consolidated,
  type ConsolidatedLoadResult,
} from "./consolidated.js";
import { buildDatasetSchema, type DatasetSchema, type ImageVariable } from "./dimensions.js";
import { resolveStoreUrl } from "./url_state.js";

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

function createFetchStore(url: string, auth?: StoreAuth): zarr.FetchStore {
  const authFetch = createAuthFetch(auth);
  return new zarr.FetchStore(url, {
    fetch(request) {
      if (auth?.kind === "bearer") {
        request.headers.set("Authorization", `Bearer ${auth.token}`);
      }
      return authFetch(request);
    },
  });
}

async function loadConsolidatedForSchema(
  fetchUrl: string,
  auth?: StoreAuth,
): Promise<ConsolidatedLoadResult> {
  const authFetch = createAuthFetch(auth);

  const zarrJsonResponse = await authFetch(new URL("zarr.json", fetchUrl));
  if (zarrJsonResponse.ok) {
    const zarrJson = (await zarrJsonResponse.json()) as Record<string, unknown>;
    const consolidatedRaw = asRecord(asRecord(zarrJson.consolidated_metadata).metadata);
    if (Object.keys(consolidatedRaw).length > 0) {
      return normalizeV3Consolidated(consolidatedRaw, asRecord(zarrJson.attributes));
    }
  }

  const zmetadataResponse = await authFetch(new URL(".zmetadata", fetchUrl));
  if (!zmetadataResponse.ok) {
    const status = zmetadataResponse.status === 401 || zarrJsonResponse.status === 401
      ? " (authentication required?)"
      : "";
    throw new Error(
      `Failed to load consolidated metadata (zarr.json: ${zarrJsonResponse.status}, .zmetadata: ${zmetadataResponse.status})${status}`,
    );
  }

  const zmetadata = (await zmetadataResponse.json()) as Record<string, unknown>;
  return normalizeV2Consolidated(zmetadata);
}

export function resetDatasetCaches(): void {
  byteCache.clear();
  arrayCache.clear();
}

export async function openDataset(url: string, auth?: StoreAuth): Promise<OpenDatasetResult> {
  ensureCodec();
  resetDatasetCaches();
  const normalized = resolveStoreUrl(url);
  if (!normalized) {
    throw new Error("Empty store URL");
  }

  const fetchUrl = storeUrlForFetch(normalized, auth);
  const { consolidated, rootAttributes } = await loadConsolidatedForSchema(fetchUrl, auth);

  const baseStore = createFetchStore(fetchUrl, auth);
  const cachedStore = zarr.withByteCaching(baseStore, { cache: byteCache });
  const store = await zarr.withConsolidatedMetadata(cachedStore, { format: ["v3", "v2"] });
  const root = zarr.root(store);
  const schema = buildDatasetSchema(fetchUrl, consolidated, rootAttributes);
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
  const node = await zarr.open(root.resolve(coordPath), { kind: "array" });
  if (!(node instanceof zarr.Array)) {
    throw new Error(`Expected coordinate array at ${coordPath}`);
  }
  const chunk = await zarr.get(node, [zarr.slice(null)]);
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
