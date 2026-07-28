import { resolveStoreUrl, toShareableStoreUrl } from "./url_state.js";

function withLocation(origin: string, run: () => void): void {
  const previous = globalThis.window;
  globalThis.window = { location: { origin } } as Window & typeof globalThis;
  try {
    run();
  } finally {
    globalThis.window = previous;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

withLocation("https://demos.oie-lab.net", () => {
  assert(
    resolveStoreUrl("/stac/data/fisheye/sophia.zarr/") ===
      "https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/",
    "path-only URL resolves against current origin",
  );
  assert(
    resolveStoreUrl("https://example.com/store.zarr") ===
      "https://example.com/store.zarr/",
    "absolute URL keeps scheme and adds trailing slash",
  );
  assert(
    toShareableStoreUrl("https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/") ===
      "/stac/data/fisheye/sophia.zarr/",
    "same-origin absolute URL becomes path-only",
  );
  assert(
    toShareableStoreUrl("https://example.com/store.zarr/") ===
      "https://example.com/store.zarr/",
    "foreign absolute URL stays absolute",
  );
});

console.log("url_state.test.ts: ok");
