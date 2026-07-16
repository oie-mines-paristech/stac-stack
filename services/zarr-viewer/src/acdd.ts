/** Attribute Convention for Data Discovery (ACDD) 1–3 global attribute names. */
export const ACDD_GLOBAL_KEYS = new Set([
  "acknowledgment",
  "acknowledgement",
  "comment",
  "contributor_email",
  "contributor_name",
  "contributor_role",
  "contributor_url",
  "creator_email",
  "creator_institution",
  "creator_name",
  "creator_type",
  "creator_url",
  "date_created",
  "date_issued",
  "date_metadata_modified",
  "date_modified",
  "geospatial_lat_max",
  "geospatial_lat_min",
  "geospatial_lat_units",
  "geospatial_lon_max",
  "geospatial_lon_min",
  "geospatial_lon_units",
  "geospatial_vertical_max",
  "geospatial_vertical_min",
  "geospatial_vertical_positive",
  "geospatial_vertical_units",
  "history",
  "id",
  "institution",
  "keywords",
  "keywords_vocabulary",
  "license",
  "metadata_link",
  "metadata_type",
  "naming_authority",
  "platform",
  "processing_level",
  "product_version",
  "program",
  "project",
  "publisher_email",
  "publisher_name",
  "publisher_url",
  "references",
  "source",
  "standard_name_vocabulary",
  "summary",
  "time_coverage_duration",
  "time_coverage_end",
  "time_coverage_resolution",
  "time_coverage_start",
  "title",
]);

const TECHNICAL_KEY = /^(zarr_|_)/i;

export function isTechnicalAttribute(key: string): boolean {
  return TECHNICAL_KEY.test(key) || key === "zarr_encoding" || key === "zarr_chunks" || key === "zarr_shards";
}

export function partitionAttributes(attrs: Record<string, unknown>): {
  primary: Array<[string, unknown]>;
  extra: Array<[string, unknown]>;
} {
  const primary: Array<[string, unknown]> = [];
  const extra: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (isTechnicalAttribute(key)) {
      extra.push([key, value]);
    } else if (ACDD_GLOBAL_KEYS.has(key)) {
      primary.push([key, value]);
    } else {
      extra.push([key, value]);
    }
  }
  primary.sort(([a], [b]) => a.localeCompare(b));
  extra.sort(([a], [b]) => a.localeCompare(b));
  return { primary, extra };
}

export function variableDescription(attrs: Record<string, unknown>): string | undefined {
  for (const key of ["long_name", "comment", "description", "summary"]) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function variableUnit(attrs: Record<string, unknown>): string | undefined {
  for (const key of ["units", "unit"]) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function variablePrimaryAttributes(
  attrs: Record<string, unknown>,
): Array<[string, unknown]> {
  const primary: Array<[string, unknown]> = [];
  const desc = variableDescription(attrs);
  const unit = variableUnit(attrs);
  if (desc) primary.push(["description", desc]);
  if (unit) primary.push(["unit", unit]);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "comment" || key === "long_name" || key === "description" || key === "units" || key === "unit") {
      continue;
    }
    if (isTechnicalAttribute(key)) continue;
    if (ACDD_GLOBAL_KEYS.has(key)) primary.push([key, value]);
  }
  return primary;
}

export function variableExtraAttributes(
  attrs: Record<string, unknown>,
): Array<[string, unknown]> {
  const extra: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (isTechnicalAttribute(key)) {
      extra.push([key, value]);
      continue;
    }
    if (ACDD_GLOBAL_KEYS.has(key)) continue;
    if (["comment", "long_name", "description", "units", "unit"].includes(key)) continue;
    extra.push([key, value]);
  }
  extra.sort(([a], [b]) => a.localeCompare(b));
  return extra;
}
