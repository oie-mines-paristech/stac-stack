#!/usr/bin/env node
"use strict";

// OIE runtime for stac-browser v5 (stands in for the upstream nginx image).
// Generates runtime-config.js from SB_* env at container start and serves the
// built SPA (with history-mode fallback). Branding and catalog URL are injected
// at runtime, so the same image serves any org. Prod targets dist/, dev (vite)
// targets public/ + the project-root index.html — see CONFIG_OUTPUT/INDEX_HTML.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = "/app";
const DIST_DIR = process.env.STAC_DIST_DIR || path.join(ROOT, "dist");
const SCHEMA_PATH = process.env.STAC_SCHEMA_PATH || "/etc/stac/config.schema.json";
const BRANDING_DIR = process.env.STAC_BRANDING_DIR || "/branding";
const SERVE_PORT = parseInt(process.env.SERVER_PORT || "8081", 10);

// In production the generated config/branding land in dist/ (the built SPA that
// this server serves). In dev the vite dev server serves the project root, so
// the same content must be injected into ROOT/public/ and ROOT/index.html — the
// dist copies would silently never be requested and the SPA would fall back to
// the build-time defaults (catalogUrl = CDSE).
const DEV = isDev();
const CONFIG_OUTPUT = process.env.STAC_CONFIG_OUTPUT || (DEV
  ? path.join(ROOT, "public", "runtime-config.js")
  : path.join(DIST_DIR, "runtime-config.js"));
const INDEX_HTML = process.env.STAC_INDEX_HTML || ((DEV ? ROOT : DIST_DIR) + "/index.html");

// OIE runtime config extensions, not in the upstream schema. Accepted via SB_*
// or branding/config.yaml, merged into the schema copy so they are typed too.
const EXTRA_SCHEMA = {
  widgetConfigs: { type: ["object"] },
  // Helper: collection id(s) for the "En vedette" (Featured) slot on the
  // landing page. Derived into widgetConfigs when the latter is not set.
  featuredCollections: { type: ["array"] },
  // Custom asset viewers: iframe/preview blocks added to asset browsing.
  // List of {id, title, icon, match: {type, roles, key}, url, mode, height},
  // see branding/config.yaml. Read by src/oie/assetViewers.js.
  assetViewers: { type: ["array"] },
};

// Keys consumed directly by serve.js (not written into the runtime config).
const BRANDING_DIRECT = new Set(["css", "favicon"]);

function isDev() {
  return /^(1|true|TRUE|yes|YES)$/.test(process.env.DEV || "");
}

function jsonSchemaType(schema, key) {
  if (!schema.properties || !schema.properties[key]) return null;
  const type = schema.properties[key].type;
  return Array.isArray(type) ? type[0] : type;
}

// Env values arrive as strings; branding/config.* values are already typed.
// Only coerce strings, pass everything else through.
function encodeValue(type, value) {
  if (typeof value !== "string") {
    return value;
  }
  switch (type) {
    case "boolean":
      if (["true", "1", "yes", "TRUE"].includes(value)) return true;
      if (["false", "0", "no", "FALSE"].includes(value)) return false;
      return value;
    case "integer":
    case "number":
      return Number(value);
    case "array": {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* fall through */
      }
      // YAML-flow style "[a, b]" (unquoted) or comma-separated list
      return value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    case "object":
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

// Per-org config sources, in increasing precedence:
//   defaults < branding/config.(yaml|json) < SB_* environment
function loadBrandingConfig() {
  const candidates = [];
  if (process.env.STAC_BRANDING_CONFIG) {
    candidates.push(process.env.STAC_BRANDING_CONFIG);
  }
  candidates.push(
    path.join(BRANDING_DIR, "config.yaml"),
    path.join(BRANDING_DIR, "config.yml"),
    path.join(BRANDING_DIR, "config.json"),
  );
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    try {
      const parsed = file.endsWith(".json") ? JSON.parse(text) : require("yaml").parse(text);
      if (parsed && typeof parsed === "object") {
        console.log(`[serve] branding config: ${file}`);
        return parsed;
      }
    } catch (err) {
      console.error(`[serve] cannot parse ${file}: ${err.message}`);
    }
    return {};
  }
  return {};
}

function computeConfig() {
  let schema = { properties: Object.assign({}, EXTRA_SCHEMA) };
  try {
    const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    schema.properties = Object.assign({}, EXTRA_SCHEMA, raw.properties);
  } catch (err) {
    console.error(`[serve] warning: cannot read schema ${SCHEMA_PATH}: ${err.message}`);
  }

  const envRaw = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^SB_(.+)$/.exec(name);
    if (match) envRaw[match[1]] = value;
  }
  const raw = Object.assign(loadBrandingConfig(), envRaw); // env wins

  const overrides = {};
  const branding = {};
  for (const [key, value] of Object.entries(raw)) {
    if (BRANDING_DIRECT.has(key)) {
      branding[key] = value;
      continue;
    }
    if (!schema.properties[key]) {
      console.warn(`[serve] unknown config key: ${key}`);
      continue;
    }
    overrides[key] = encodeValue(jsonSchemaType(schema, key), value);
  }

  const config = Object.assign({ catalogUrl: "/api/" }, overrides);
  if (config.widgetConfigs === undefined && config.featuredCollections !== undefined) {
    config.widgetConfigs = {
      "view-catalog-catalogs-start": [{ id: "Featured", props: { entities: config.featuredCollections } }],
    };
  }
  delete config.featuredCollections;
  resolveAssetViewerEnv(config);
  branding.cssList = String(branding.css || "").split(",").map((s) => s.trim()).filter(Boolean);
  branding.favicon = String(branding.favicon || "").trim();
  return { config, branding };
}

// In assetViewers query dicts, uppercase values are ENV var names (client has
// no access to the server env). Resolve them here at container start and drop
// the query param when the variable is unset/empty. Lowercase values (href,
// asset attribute names) are resolved at runtime on each asset.
function resolveAssetViewerEnv(config) {
  const viewers = config.assetViewers;
  if (!Array.isArray(viewers)) {
    return;
  }
  for (const viewer of viewers) {
    const query = viewer && viewer.query && typeof viewer.query === "object" ? viewer.query : null;
    if (!query) {
      continue;
    }
    for (const [name, spec] of Object.entries(query)) {
      if (typeof spec !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(spec)) {
        continue;
      }
      const value = process.env[spec];
      if (value !== "" && value != null) {
        query[name] = value;
      } else {
        delete query[name];
      }
    }
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_OUTPUT), { recursive: true });
  fs.writeFileSync(CONFIG_OUTPUT, `window.STAC_BROWSER_CONFIG = ${JSON.stringify(config)};\n`);
  console.log(`[serve] wrote ${CONFIG_OUTPUT}`);
}

// Inject CSS/favicon <link> tags from SB_css / SB_favicon into dist/index.html.
// Keeps the image generic: each org's look is applied at container start.
function injectBranding(branding, catalogTitle) {
  const indexPath = INDEX_HTML;
  if (!fs.existsSync(indexPath)) return;

  const links = [];
  for (const href of branding.cssList) {
    links.push(`<link rel="stylesheet" href="${href}">`);
  }
  if (branding.favicon) {
    links.push(`<link rel="icon" href="${branding.favicon}">`);
  }
  if (!links.length) return;

  const html = fs.readFileSync(indexPath, "utf8");
  let updated = html.replace(/<\/head>\s*/, links.join("\n    ") + "\n  </head>");
  // Static og:site_name in the built index.html carries the org defaults;
  // rebrand it from the runtime title so social shares don't leak the other org.
  if (catalogTitle) {
    updated = updated.replace(
      /<meta[^>]*name="og:site_name"[^>]*>/,
      `<meta name="og:site_name" content="${catalogTitle}">`,
    );
  }
  if (updated !== html) {
    fs.writeFileSync(indexPath, updated);
    console.log(`[serve] injected branding links: ${links.join(" ")}`);
  }
}

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// Serve a file from a fixed root with path-traversal protection. 404 on miss.
function serveFrom(root, reqPath, res) {
  let rel = path.relative(root, path.join(root, reqPath));
  if (rel.startsWith("..") || rel.startsWith("/") || rel.includes("\0")) {
    res.writeHead(404);
    return res.end();
  }
  const filePath = path.join(root, rel);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return sendFile(res, filePath, true);
  }
  res.writeHead(404);
  return res.end();
}

function sendFile(res, filePath, allowCache) {
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Content-Length": body.length,
    "Cache-Control": allowCache ? "public, max-age=31536000, immutable" : "no-cache, no-store, must-revalidate",
  });
  if (res.req.method === "HEAD") return res.end();
  res.end(body);
}

function serveStatic() {
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    console.error(`[serve] missing ${DIST_DIR}/index.html`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split("?")[0]);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    let rel = path.relative(DIST_DIR, path.join(DIST_DIR, urlPath));
    if (rel.startsWith("..") || rel.startsWith("/") || rel.includes("\0")) rel = null;

    let filePath = rel ? path.join(DIST_DIR, rel) : null;

    if (urlPath.startsWith("/branding/")) {
      return serveFrom(BRANDING_DIR, urlPath.replace(/^\/branding/, ""), res);
    }

    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const allowCache = !filePath.endsWith("runtime-config.js")
        && /\.(js|css|png|jpe?g|svg|gif|webp|woff2?|ttf|wasm)$/.test(filePath);
      return sendFile(res, filePath, allowCache);
    }

    sendFile(res, path.join(DIST_DIR, "index.html"), false);
  });

  server.listen(SERVE_PORT, "0.0.0.0", () => {
    console.log(`[serve] static server on :${SERVE_PORT} (${DIST_DIR})`);
  });
}

function serveDev() {
  const child = spawn(
    "npm",
    ["run", "start", "--", "--host", "0.0.0.0", "--port", String(SERVE_PORT)],
    { cwd: ROOT, stdio: "inherit", env: process.env },
  );
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGINT", () => forward("SIGINT"));
  child.on("exit", (code) => process.exit(code || 0));
}

function apply() {
  const { config, branding } = computeConfig();
  writeConfig(config);
  injectBranding(branding, config.catalogTitle);
}

// Dev only: re-read branding/config.yaml when it changes on the host, so an
// edit is applied without restarting the container. The regenerated
// public/runtime-config.js is watched by vite, which full-reloads the SPA.
function watchBranding() {
  const candidates = [];
  if (process.env.STAC_BRANDING_CONFIG) candidates.push(process.env.STAC_BRANDING_CONFIG);
  candidates.push(
    path.join(BRANDING_DIR, "config.yaml"),
    path.join(BRANDING_DIR, "config.yml"),
    path.join(BRANDING_DIR, "config.json"),
  );
  const watched = new Set(candidates.map((f) => path.basename(f)));
  for (const dir of new Set(candidates.map((f) => path.dirname(path.resolve(f))))) {
    if (!fs.existsSync(dir)) continue;
    try {
      fs.watch(dir, (event, filename) => {
        if (filename && watched.has(filename)) {
          console.log(`[serve] branding config changed: ${path.join(dir, filename)}`);
          apply();
        }
      });
    } catch (err) {
      console.warn(`[serve] cannot watch ${dir}: ${err.message}`);
    }
  }
}

apply();
if (isDev()) {
  watchBranding();
  serveDev();
} else {
  serveStatic();
}