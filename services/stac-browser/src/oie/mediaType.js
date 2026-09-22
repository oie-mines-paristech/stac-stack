import { formatMediaType } from '@radiantearth/stac-fields/formatters';

// User-friendly labels for media types the upstream formatter names after the
// raw subtype. `formatMediaType` falls back to title-casing the subtype, e.g.
// "application/x-ipynb+json" → "Ipynb+json"; override the ugly ones here.
const LABELS = {
  'application/x-ipynb+json': { short: 'Notebook', long: 'Jupyter notebook' },
};

export function formatAssetMediaType(value, spec = {}) {
  const type = typeof value === 'string' ? value.toLowerCase().split(';')[0].trim() : null;
  const label = type ? LABELS[type] : null;
  if (label) {
    return spec.shorten ? label.short : label.long;
  }
  return formatMediaType(value, null, spec);
}