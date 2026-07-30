import * as zarr from "zarrita";
import { registerJpegxlCodec } from "@oie-minesparis-psl/jpegxl-zarr";
import { loadFull1DArray } from "./array_load.js";
import type { StoreAuth } from "./auth.js";
import { resolveStoreAuth, storeUrlForFetch } from "./auth.js";
import { createStoreFetch } from "./proxy.js";
import {
  createInstrumentedByteCache,
  wrapFetchWithConcurrency,
} from "./chunk_progress.js";
import {
  normalizeV2Consolidated,
  normalizeV3Consolidated,
  type ConsolidatedLoadResult,
} from "./consolidated.js";
import {
  buildDatasetSchema,
  type DatasetSchema,
  type ImageVariable,
} from "./dimensions.js";
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
const coordinateCache = new Map<string, unknown[]>();

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

function createInstrumentedStoreFetch(auth?: StoreAuth): typeof fetch {
  return wrapFetchWithConcurrency(createStoreFetch(auth));
}

function createFetchStore(url: string, auth?: StoreAuth): zarr.FetchStore {
  return new zarr.FetchStore(url, { fetch: createInstrumentedStoreFetch(auth) });
}

export interface StoreConnection {
  normalized: string;
  fetchUrl: string;
  effectiveAuth: StoreAuth | undefined;
}

export function resolveStoreConnection(url: string, auth?: StoreAuth): StoreConnection {
  const normalized = resolveStoreUrl(url);
  if (!normalized) {
    throw new Error("Empty store URL");
  }
  const effectiveAuth = auth ?? resolveStoreAuth(normalized, null);
  const fetchUrl = storeUrlForFetch(normalized, effectiveAuth);
  return { normalized, fetchUrl, effectiveAuth };
}

export async function fetchConsolidatedMetadata(
  fetchUrl: string,
  auth?: StoreAuth,
  options?: { fetch?: typeof fetch },
): Promise<ConsolidatedLoadResult> {
  const authFetch = options?.fetch ?? createInstrumentedStoreFetch(auth);

  const zarrJsonResponse = await authFetch(new URL("zarr.json", fetchUrl));
  if (zarrJsonResponse.ok) {
    let zarrJson: Record<string, unknown> | null = null;
    try {
      zarrJson = (await zarrJsonResponse.json()) as Record<string, unknown>;
    } catch {
      // Static hosts may return index.html (200) when zarr.json is missing.
      zarrJson = null;
    }
    if (zarrJson) {
      const consolidatedRaw = asRecord(asRecord(zarrJson.consolidated_metadata).metadata);
      if (Object.keys(consolidatedRaw).length > 0) {
        return normalizeV3Consolidated(consolidatedRaw, asRecord(zarrJson.attributes));
      }
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
  coordinateCache.clear();
}

export function clearCoordinateCache(): void {
  coordinateCache.clear();
}

export function getCachedCoordinateValues(coordPath: string): unknown[] | undefined {
  const cached = coordinateCache.get(coordPath);
  return cached ? [...cached] : undefined;
}

export async function preloadVariableCoordinates(
  root: OpenDatasetResult["root"],
  variable: ImageVariable,
): Promise<void> {
  ensureCodec();
  const paths = new Set<string>();
  for (const axis of variable.axes) {
    if (axis.coordinate?.path) paths.add(axis.coordinate.path);
  }

  await Promise.all(
    [...paths].map(async (path) => {
      if (coordinateCache.has(path)) return;
      const node = await zarr.open(root.resolve(path), { kind: "array" });
      if (!(node instanceof zarr.Array)) return;
      coordinateCache.set(path, await loadFull1DArray(node));
    }),
  );
}

export async function connectStore(url: string, auth?: StoreAuth): Promise<OpenDatasetResult> {
  ensureCodec();
  resetDatasetCaches();
  const { fetchUrl, effectiveAuth } = resolveStoreConnection(url, auth);
  const { consolidated, rootAttributes } = await fetchConsolidatedMetadata(fetchUrl, effectiveAuth);

  const baseStore = createFetchStore(fetchUrl, effectiveAuth);
  const cachedStore = zarr.withByteCaching(baseStore, {
    cache: createInstrumentedByteCache(byteCache),
  });
  const store = await zarr.withConsolidatedMetadata(cachedStore, { format: ["v3", "v2"] });
  const root = zarr.root(store);
  const schema = buildDatasetSchema(fetchUrl, consolidated, rootAttributes);
  if (schema.variables.length === 0) {
    throw new Error("No image-like variables found in consolidated metadata");
  }
  return { schema, store, root };
}

export async function openDataset(url: string, auth?: StoreAuth): Promise<OpenDatasetResult> {
  return connectStore(url, auth);
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
  const cached = coordinateCache.get(coordPath);
  if (cached) return [...cached];

  ensureCodec();
  const node = await zarr.open(root.resolve(coordPath), { kind: "array" });
  if (!(node instanceof zarr.Array)) {
    throw new Error(`Expected coordinate array at ${coordPath}`);
  }
  const values = await loadFull1DArray(node);
  coordinateCache.set(coordPath, values);
  return [...values];
}

export function shardSummary(variable: ImageVariable): string | undefined {
  const shards = variable.attributes.zarr_shards;
  if (!shards || typeof shards !== "object") return undefined;
  const time = (shards as Record<string, unknown>).time;
  if (time === 96) return "daily (96×15 min steps per shard)";
  if (typeof time === "number") return `time shard size ${time}`;
  return JSON.stringify(shards);
}
