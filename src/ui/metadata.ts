import {
  partitionAttributes,
  variableDescription,
  variableExtraAttributes,
  variablePrimaryAttributes,
  variableUnit,
} from "../acdd.js";
import type { StoreAuth } from "../auth.js";
import { formatAuthLabel } from "../auth.js";
import type { CoordinateMeta, DatasetSchema, ImageVariable } from "../dimensions.js";
import { shardSummary } from "../store.js";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatAttr(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function renderDl(entries: Array<[string, unknown]>): string {
  if (entries.length === 0) return "";
  return `<dl>${entries
    .map(
      ([key, value]) =>
        `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatAttr(value))}</dd>`,
    )
    .join("")}</dl>`;
}

function renderExtraBlock(title: string, entries: Array<[string, unknown]>): string {
  if (entries.length === 0) return "";
  return `<section class="extra-block"><h4>${escapeHtml(title)}</h4>${renderDl(entries)}</section>`;
}

function renderCoordinateExtra(coords: CoordinateMeta[]): string {
  return coords
    .map((coord) => {
      const entries = Object.entries(coord.attributes)
        .filter(([key]) => !key.startsWith("_"))
        .sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) return "";
      return renderExtraBlock(`Coordinate: ${coord.path}`, entries);
    })
    .join("");
}

export function renderMetadataPanel(
  container: HTMLElement,
  schema: DatasetSchema,
  variable: ImageVariable,
  auth?: StoreAuth,
): void {
  const storePrimary = partitionAttributes(schema.rootAttributes).primary;
  const storeExtra = partitionAttributes(schema.rootAttributes).extra;

  const description = variableDescription(variable.attributes);
  const unit = variableUnit(variable.attributes);
  const variablePrimary = variablePrimaryAttributes(variable.attributes);
  const variableExtra = variableExtraAttributes(variable.attributes);
  const linkedCoords = variable.axes
    .map((axis) => axis.coordinate)
    .filter((coord): coord is CoordinateMeta => Boolean(coord));

  const dimensionLines = variable.axes
    .map((axis) => `<dt>${escapeHtml(axis.name)}</dt><dd>${axis.size}</dd>`)
    .join("");

  const technicalEntries: Array<[string, unknown]> = [
    ["dtype", variable.dtype],
    ["shape", `[${variable.shape.join(", ")}]`],
    ...variableExtra,
  ];
  const shard = shardSummary(variable);
  if (shard) technicalEntries.unshift(["zarr_shards (summary)", shard]);

  const authLabel = formatAuthLabel(auth);

  const extraSections = [
    renderExtraBlock("Store", storeExtra),
    renderExtraBlock(`Variable: ${variable.path}`, technicalEntries.map(([k, v]) => [k, v] as [string, unknown])),
    renderCoordinateExtra(linkedCoords),
    authLabel
      ? `<section class="extra-block"><h4>Authentication</h4><p class="muted">${escapeHtml(authLabel)}</p></section>`
      : "",
    `<section class="extra-block"><h4>Store URL</h4><p class="muted">${escapeHtml(schema.url)}</p></section>`,
  ].join("");

  container.innerHTML = `
    <h2>Metadata</h2>
    ${
      storePrimary.length > 0
        ? `<section><h3>Dataset</h3>${renderDl(storePrimary)}</section>`
        : ""
    }
    <section>
      <h3>Variable: ${escapeHtml(variable.path)}</h3>
      <dl>${dimensionLines}</dl>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      ${unit ? `<p class="muted">Unit: ${escapeHtml(unit)}</p>` : ""}
      ${variablePrimary.length > 0 ? renderDl(variablePrimary.filter(([key]) => key !== "description" && key !== "unit")) : ""}
    </section>
    <details class="extra-metadata">
      <summary>Extra metadata</summary>
      ${extraSections}
    </details>
  `;
}

export function renderStatus(container: HTMLElement, message: string): void {
  container.textContent = message;
}

export function renderTimings(container: HTMLElement, message: string): void {
  container.textContent = message;
}
