#!/usr/bin/env node
"use strict";

// OIE runtime for stac-browser v5 (stands in for the upstream nginx image).
// Generates dist/runtime-config.js from SB_* env at container start and
// serves the built SPA (with history-mode fallback). Branding and catalog
// URL are injected at runtime, so the same image serves any org.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = "/app";
const DIST_DIR = process.env.STAC_DIST_DIR || path.join(ROOT, "dist");
const CONFIG_OUTPUT = process.env.STAC_CONFIG_OUTPUT || path.join(DIST_DIR, "runtime-config.js");
const SCHEMA_PATH = process.env.STAC_SCHEMA_PATH || "/etc/stac/config.schema.json";
const BRANDING_DIR = process.env.STAC_BRANDING_DIR || "/branding";
const SERVE_PORT = parseInt(process.env.SERVER_PORT || "8081", 10);

// OIE runtime config extensions, not in the upstream schema. Accepted as SB_*,
// merged into the schema copy so the SB_* loop below types them correctly.
const EXTRA_SCHEMA = {
  widgetConfigs: { type: ["object"] },
};

// SB_* consumed directly by serve.js (not written into the runtime config).
const BRANDING_ENV = new Set(["SB_css", "SB_favicon"]);

function isDev() {
  return /^(1|true|TRUE|yes|YES)$/.test(process.env.DEV || "");
}

function jsonSchemaType(schema, key) {
  if (!schema.properties || !schema.properties[key]) return null;
  const type = schema.properties[key].type;
  return Array.isArray(type) ? type[0] : type;
}

function encodeValue(type, value) {
  switch (type) {
    case "boolean":
      if (["true", "1", "yes", "TRUE"].includes(value)) return true;
      if (["false", "0", "no", "FALSE"].includes(value)) return false;
      return value;
    case "integer":
    case "number":
      return Number(value);
    case "array":
      try {
        return JSON.parse(value);
      } catch {
        return value ? value.split(",").map((s) => s.trim()) : [];
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

function generateConfig() {
  let schema = { properties: Object.assign({}, EXTRA_SCHEMA) };
  try {
    const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    schema.properties = Object.assign({}, EXTRA_SCHEMA, raw.properties);
  } catch (err) {
    console.error(`[serve] warning: cannot read schema ${SCHEMA_PATH}: ${err.message}`);
  }

  const overrides = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^SB_(.+)$/.exec(name);
    if (!match || BRANDING_ENV.has(name)) continue;
    const key = match[1];
    if (!schema.properties[key]) {
      console.warn(`[serve] unknown SB_ config key: ${key}`);
      continue;
    }
    overrides[key] = encodeValue(jsonSchemaType(schema, key), value);
  }

  const config = Object.assign({ catalogUrl: "/api/" }, overrides);
  fs.mkdirSync(path.dirname(CONFIG_OUTPUT), { recursive: true });
  fs.writeFileSync(CONFIG_OUTPUT, `window.STAC_BROWSER_CONFIG = ${JSON.stringify(config)};\n`);
  console.log(`[serve] wrote ${CONFIG_OUTPUT}`);
  return config;
}

// Inject CSS/favicon <link> tags from SB_css / SB_favicon into dist/index.html.
// Keeps the image generic: each org's look is applied at container start.
function injectBranding() {
  const indexPath = path.join(DIST_DIR, "index.html");
  if (!fs.existsSync(indexPath)) return;

  const cssList = (process.env.SB_css || "").split(",").map((s) => s.trim()).filter(Boolean);
  const favicon = (process.env.SB_favicon || "").trim();
  const links = [];
  for (const href of cssList) {
    links.push(`<link rel="stylesheet" href="${href}">`);
  }
  if (favicon) {
    links.push(`<link rel="icon" href="${favicon}">`);
  }
  if (!links.length) return;

  const html = fs.readFileSync(indexPath, "utf8");
  let updated = html.replace(/<\/head>\s*/, links.join("\n    ") + "\n  </head>");
  // Static og:site_name in the built index.html carries the org defaults;
  // rebrand it from the runtime title so social shares don't leak the other org.
  const catalogTitle = process.env.SB_catalogTitle;
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

generateConfig();
injectBranding();
if (isDev()) {
  serveDev();
} else {
  serveStatic();
}