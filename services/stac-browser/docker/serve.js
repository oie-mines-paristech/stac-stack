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
const SERVE_PORT = parseInt(process.env.SERVER_PORT || "8081", 10);

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
  let schema = { properties: {} };
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  } catch (err) {
    console.error(`[serve] warning: cannot read schema ${SCHEMA_PATH}: ${err.message}`);
  }

  const overrides = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^SB_(.+)$/.exec(name);
    if (!match || match[1] === "CATALOGURL" && !value) continue;
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

    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const allowCache = /\.(js|css|png|jpe?g|svg|gif|webp|woff2?|ttf|wasm)$/.test(filePath);
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
if (isDev()) {
  serveDev();
} else {
  serveStatic();
}