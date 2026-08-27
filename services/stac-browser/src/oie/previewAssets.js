const HTML_PREVIEW_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
]);

const NOTEBOOK_PREVIEW_TYPES = new Set([
  'application/x-ipynb+json',
  'application/vnd.jupyter.notebook+json',
]);

const DEFAULT_PREVIEW_HEIGHT = 350;

function normalizeMediaType(type) {
  if (typeof type !== 'string') {
    return null;
  }
  return type.toLowerCase().split(';')[0].trim();
}

function hasPreviewRole(asset) {
  return Boolean(asset && Array.isArray(asset.roles) && asset.roles.includes('preview'));
}

export function isHtmlPreviewAsset(asset) {
  if (!hasPreviewRole(asset)) {
    return false;
  }
  const type = normalizeMediaType(asset.type);
  return type !== null && HTML_PREVIEW_TYPES.has(type);
}

export function isNotebookPreviewAsset(asset) {
  if (!hasPreviewRole(asset)) {
    return false;
  }
  const type = normalizeMediaType(asset.type);
  return type !== null && NOTEBOOK_PREVIEW_TYPES.has(type);
}

export function isPreviewAsset(asset) {
  return isHtmlPreviewAsset(asset) || isNotebookPreviewAsset(asset);
}

export function getAssetBoolean(asset, key) {
  const value = asset?.[key];
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return null;
}

export function getPreviewHeight(asset, defaultHeight = DEFAULT_PREVIEW_HEIGHT) {
  const value = asset?.['preview:height'];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return defaultHeight;
}

export function shouldExpandAsset(asset, { definition = false, isSingleItem = false } = {}) {
  if (definition) {
    return false;
  }
  const expand = getAssetBoolean(asset, 'expand');
  if (expand !== null) {
    return expand;
  }
  if (isSingleItem) {
    return true;
  }
  return false;
}

export function getPreviewMode(asset) {
  if (isHtmlPreviewAsset(asset)) {
    return 'html';
  }
  if (isNotebookPreviewAsset(asset)) {
    return 'notebook';
  }
  return null;
}
