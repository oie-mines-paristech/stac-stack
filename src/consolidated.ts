function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Extract Zarr chunk shape from consolidated v2/v3 array metadata. */
export function extractChunkShape(meta: Record<string, unknown>): number[] | undefined {
  const chunkGrid = asRecord(meta.chunk_grid);
  const gridConfig = asRecord(chunkGrid.configuration);
  if (Array.isArray(gridConfig.chunk_shape)) {
    return gridConfig.chunk_shape.map(Number);
  }
  if (Array.isArray(meta.chunks)) {
    return meta.chunks.map(Number);
  }
  return undefined;
}

export interface ConsolidatedLoadResult {
  consolidated: Record<string, unknown>;
  rootAttributes: Record<string, unknown>;
}

/** Normalize v3 consolidated_metadata.metadata entries for buildDatasetSchema. */
export function normalizeV3Consolidated(
  metadata: Record<string, unknown>,
  rootAttributes: Record<string, unknown> = {},
): ConsolidatedLoadResult {
  const consolidated: Record<string, unknown> = {};
  for (const [path, raw] of Object.entries(metadata)) {
    const meta = asRecord(raw);
    const normalizedPath = path.replace(/^\/+/, "").replace(/\/zarr\.json$/, "");
    if (!normalizedPath) continue;
    consolidated[normalizedPath] = {
      ...meta,
      data_type: meta.data_type ?? meta.dtype,
      dimension_names: meta.dimension_names ?? meta.dimensionNames,
    };
  }
  return { consolidated, rootAttributes };
}

/** Merge v2 .zmetadata keys (path/.zarray + path/.zattrs) into schema entries. */
export function normalizeV2Consolidated(zmetadata: Record<string, unknown>): ConsolidatedLoadResult {
  const metadata = asRecord(zmetadata.metadata);
  const arrays = new Map<
    string,
    { zarray?: Record<string, unknown>; zattrs?: Record<string, unknown> }
  >();
  let rootAttributes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const meta = asRecord(value);
    if (key === ".zattrs") {
      rootAttributes = { ...rootAttributes, ...meta };
      continue;
    }
    if (key === ".zgroup") {
      rootAttributes = { ...rootAttributes, ...asRecord(meta.attributes) };
      continue;
    }

    const zarrayMatch = key.match(/^(.+)\/\.zarray$/);
    const zattrsMatch = key.match(/^(.+)\/\.zattrs$/);
    if (zarrayMatch) {
      const path = zarrayMatch[1];
      const entry = arrays.get(path) ?? {};
      entry.zarray = meta;
      arrays.set(path, entry);
    } else if (zattrsMatch) {
      const path = zattrsMatch[1];
      const entry = arrays.get(path) ?? {};
      entry.zattrs = meta;
      arrays.set(path, entry);
    }
  }

  const consolidated: Record<string, unknown> = {};
  for (const [path, { zarray, zattrs }] of arrays) {
    if (!zarray) continue;
    const shape = zarray.shape;
    if (!Array.isArray(shape)) continue;

    const attrs = { ...(zattrs ?? {}) };
    const dimensionNames = Array.isArray(attrs._ARRAY_DIMENSIONS)
      ? (attrs._ARRAY_DIMENSIONS as unknown[]).map(String)
      : shape.length === 1
        ? [path]
        : undefined;
    const { _ARRAY_DIMENSIONS: _dims, ...attributes } = attrs;

    consolidated[path] = {
      shape,
      chunks: zarray.chunks,
      data_type: zarray.dtype ?? zarray.data_type ?? "unknown",
      dimension_names: dimensionNames,
      attributes,
      node_type: "array",
    };
  }

  return { consolidated, rootAttributes };
}
