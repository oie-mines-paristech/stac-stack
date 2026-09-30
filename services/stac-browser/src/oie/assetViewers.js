// OIE: external config-driven asset viewers, injected at runtime via
// window.STAC_BROWSER_CONFIG.assetViewers (branding/config.yaml or
// SB_assetViewers). Kept out of the upstream components on purpose.

const VIEWER_DEFAULTS = {
  mode: 'inplace',
  url: '/viewer/',
  height: 480,
  expand: false,
  allowFullscreen: true,
  // Optional sort key relative to the other asset blocks and viewers. Lower
  // comes first; unset (or non-numeric) = 0. An asset block without an
  // in-place viewer also uses 0, so plain assets keep their natural position.
  order: null,
  // Add `embed=1` to the iframe URL so viewers can adapt their chrome (hide
  // download buttons, standalone headers, …). There is no standard query
  // param for this; the reliable signals are the `Sec-Fetch-Dest: iframe`
  // header and `window.self !== window.top`, but a plain param is what a
  // viewer URL can carry. Set to false to omit it.
  embed: true,
  // Hide the asset's own (inherited) action buttons — download, copy URL,
  // show on map, plugin actions. The viewer keeps its own buttons unless
  // `hideViewerActions` is also set.
  hideActions: false,
  // Hide the viewer's buttons (fullscreen, open in a new tab).
  hideViewerActions: false,
  // Optional text shown between the action buttons and the iframe, overriding
  // the asset description (which is the default when this is unset).
  description: '',
};

export function getViewerConfigs() {
  const browserConfig = (typeof window !== 'undefined' && window.STAC_BROWSER_CONFIG) || {};
  const config = browserConfig.assetViewers;
  if (!Array.isArray(config)) {
    return [];
  }
  return config
    .filter(viewer => viewer && typeof viewer === 'object')
    .map(viewer => Object.assign({}, VIEWER_DEFAULTS, viewer));
}

function normalizeMediaType(type) {
  if (typeof type !== 'string') {
    return null;
  }
  return type.toLowerCase().split(';')[0].trim();
}

export function matchesViewer(viewer, asset) {
  const match = viewer.match || {};
  if (match.type !== undefined && match.type !== null) {
    if (normalizeMediaType(asset.type) !== normalizeMediaType(String(match.type))) {
      return false;
    }
  }
  if (Array.isArray(match.roles)) {
    const roles = Array.isArray(asset.roles) ? asset.roles : [];
    for (const role of match.roles) {
      if (!roles.includes(role)) {
        return false;
      }
    }
  }
  if (match.key !== undefined && match.key !== null && asset.getKey() !== match.key) {
    return false;
  }
  return true;
}

export function getViewersForAsset(asset, mode) {
  return getViewerConfigs().filter(viewer => {
    if (mode && viewer.mode !== mode) {
      return false;
    }
    return matchesViewer(viewer, asset);
  });
}

// Sort key for a viewer (or the asset block it drives in-place). Unset or
// non-numeric → 0, so untouched configs keep the default assets-then-viewers
// order (the sort in Assets.vue is stable).
export function viewerOrder(viewer) {
  const order = Number(viewer && viewer.order);
  return Number.isFinite(order) ? order : 0;
}

// Encode a substituted token value without escaping slashes, so relative
// path-only hrefs (e.g. /data/foo.zarr) stay readable while ?, &, #, spaces
// are still safe in a query-string context.
function encodePathSafe(value) {
  return encodeURIComponent(String(value)).replace(/%2F/gi, '/');
}

// Resolve one `{token}` placeholder against the runtime asset:
//   {href} / {url}   → the asset's (projected) URL
//   {attr} / {attr.path} → a (possibly dotted) attribute of the asset
// Uppercase ENV tokens are already substituted by serve.js at container start.
// Returns '' when the token cannot be resolved.
function resolveQueryToken(token, asset, href) {
  if (token === 'href' || token === 'url') {
    return href;
  }
  let obj = asset;
  for (const part of token.split('.')) {
    if (obj === undefined || obj === null) {
      return '';
    }
    obj = obj[part];
  }
  if (obj === undefined || obj === null) {
    return '';
  }
  if (typeof obj === 'object') {
    return JSON.stringify(obj);
  }
  return String(obj);
}

// Resolve a query parameter value against the runtime asset. A value with no
// `{...}` placeholder is a static literal, used verbatim (e.g. "fill").
// Otherwise every placeholder is substituted; the caller drops the param when
// one of them cannot be resolved.
function resolveQueryValue(spec, asset, href) {
  if (typeof spec !== 'string') {
    return spec === undefined || spec === null ? '' : String(spec);
  }
  if (!spec.includes('{')) {
    return spec;
  }
  let missing = false;
  const value = spec.replace(/\{([^{}]+)\}/g, (_match, token) => {
    const resolved = resolveQueryToken(token, asset, href);
    if (resolved === '') {
      missing = true;
    }
    return resolved;
  });
  return missing ? '' : value;
}

export function buildViewerUrl(viewer, asset, projectUrl = null) {
  const rawUrl = typeof asset.getAbsoluteUrl === 'function' ? asset.getAbsoluteUrl() : asset.href;
  const href = projectUrl ? projectUrl(rawUrl) : rawUrl;
  const query = viewer.query && typeof viewer.query === 'object' ? viewer.query : {};

  const params = [];
  for (const [name, spec] of Object.entries(query)) {
    const value = resolveQueryValue(spec, asset, href);
    if (value === '') {
      continue; // Not found at runtime → drop the query param.
    }
    params.push(`${encodeURIComponent(name)}=${encodePathSafe(value)}`);
  }
  if (viewer.embed !== false) {
    params.push('embed=1');
  }

  let url = String(viewer.url || '');
  if (params.length > 0) {
    url += (url.includes('?') ? '&' : '?') + params.join('&');
  }
  return url;
}

export function isImageIcon(icon) {
  return typeof icon === 'string'
    && (/^https?:\/\//.test(icon) || icon.startsWith('/') || icon.startsWith('./'));
}

export function viewerHeight(viewer) {
  const parsed = parseInt(viewer.height, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : VIEWER_DEFAULTS.height;
}