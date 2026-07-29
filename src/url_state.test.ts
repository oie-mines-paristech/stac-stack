import {
  defaultStorePathExample,
  parseBearerAuthParam,
  readViewerParams,
  resolveStoreUrl,
  serializeBearerAuthParam,
  toShareableStoreUrl,
} from "./url_state.js";

function withLocation(origin: string, pathname: string, run: () => void): void {
  const previous = globalThis.window;
  let search = "";
  globalThis.window = {
    location: {
      origin,
      pathname,
      get search() {
        return search;
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, url?: string | null) {
        if (typeof url === "string") {
          const queryIndex = url.indexOf("?");
          search = queryIndex >= 0 ? url.slice(queryIndex) : "";
        }
      },
    },
  } as Window & typeof globalThis;
  try {
    run();
  } finally {
    globalThis.window = previous;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

withLocation("http://localhost:8000", "/viewer/", () => {
  assert(
    defaultStorePathExample() === "/data/fisheye/sophia.zarr/",
    "viewer at /viewer/ suggests /data/ example path",
  );
});

withLocation("https://demos.oie-lab.net", "/stac/viewer/", () => {
  assert(
    defaultStorePathExample() === "/stac/data/fisheye/sophia.zarr/",
    "viewer at /stac/viewer/ suggests /stac/data/ example path",
  );
});

withLocation("https://demos.oie-lab.net", "/stac/viewer/", () => {
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

withLocation("https://example.com", "/", () => {
  assert(
    parseBearerAuthParam("bearer:secret-token")?.kind === "bearer",
    "parse bearer auth param",
  );
  assert(
    serializeBearerAuthParam({ kind: "bearer", token: "secret-token" }) === "bearer:secret-token",
    "serialize bearer auth param",
  );
});

withLocation("https://example.com", "/", () => {
  globalThis.window.history.replaceState(
    {},
    "",
    "/?url=https://host/data.zarr/&auth=bearer:abc123&variable=t2m",
  );
  const params = readViewerParams();
  assert(params.auth?.kind === "bearer", "readViewerParams parses bearer auth");
  assert(
    (params.auth as { token: string }).token === "abc123",
    "readViewerParams bearer token value",
  );
  assert(params.variable === "t2m", "readViewerParams keeps other params with auth");
});

withLocation("https://example.com", "/", () => {
  const basicUrl = "https://alice:secret@host/data.zarr/";
  globalThis.window.history.replaceState({}, "", `/?url=${encodeURIComponent(basicUrl)}`);
  const params = readViewerParams();
  assert(params.auth?.kind === "basic", "readViewerParams parses basic auth from url");
  assert(
    toShareableStoreUrl("https://alice:secret@host/data.zarr/").includes("alice"),
    "toShareableStoreUrl keeps basic credentials",
  );
});

withLocation("https://example.com", "/", () => {
  globalThis.window.history.replaceState(
    {},
    "",
    "/?url=https://host/data.zarr/&autoscale=0&scale=250:310,0:100",
  );
  const params = readViewerParams();
  assert(params.autoscale === false, "readViewerParams parses autoscale=0");
  assert(params.manualScale?.length === 2, "readViewerParams parses scale bands");
  assert(params.manualScale?.[0].min === 250, "scale min");
  assert(params.manualScale?.[0].max === 310, "scale max");
});

console.log("url_state.test.ts: ok");
