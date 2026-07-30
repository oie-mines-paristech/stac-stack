import { wrapFetchWithConcurrency } from "./chunk_progress.js";
import { fetchConsolidatedMetadata } from "./store.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function mockResponse(status: number, body?: unknown): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
  });
}

const storeBase = "https://example.com/data.zarr/";

async function testV3UsesZarrJsonOnly(): Promise<void> {
  const requested: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    if (url.endsWith("/zarr.json")) {
      return mockResponse(200, {
        consolidated_metadata: {
          metadata: {
            "/radiance/zarr.json": {
              data_type: "float32",
              dimension_names: ["time", "y", "x"],
              shape: [1, 2, 2],
            },
          },
        },
        attributes: {},
      });
    }
    return mockResponse(404);
  }) as typeof fetch;

  const result = await fetchConsolidatedMetadata(storeBase, undefined, {
    fetch: wrapFetchWithConcurrency(fetchFn),
  });
  assert(Object.keys(result.consolidated).includes("radiance"), "v3 consolidated parsed");
  assert(requested.some((url) => url.endsWith("/zarr.json")), "zarr.json requested");
  assert(!requested.some((url) => url.endsWith("/.zmetadata")), "no .zmetadata fallback on v3 success");
}

async function testV2FallbackToZmetadata(): Promise<void> {
  const requested: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    if (url.endsWith("/zarr.json")) {
      return mockResponse(404);
    }
    if (url.endsWith("/.zmetadata")) {
      return mockResponse(200, {
        metadata: {
          "radiance/.zarray": {
            shape: [1, 2, 2],
            chunks: [1, 2, 2],
            dtype: "<f4",
          },
        },
      });
    }
    return mockResponse(404);
  }) as typeof fetch;

  const result = await fetchConsolidatedMetadata(storeBase, undefined, {
    fetch: wrapFetchWithConcurrency(fetchFn),
  });
  assert(Object.keys(result.consolidated).includes("radiance"), "v2 consolidated parsed");
  assert(requested.some((url) => url.endsWith("/.zmetadata")), ".zmetadata requested");
}

async function test401IncludesAuthHint(): Promise<void> {
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/zarr.json") || url.endsWith("/.zmetadata")) {
      return mockResponse(401);
    }
    return mockResponse(404);
  }) as typeof fetch;

  let message = "";
  try {
    await fetchConsolidatedMetadata(storeBase, undefined, {
      fetch: wrapFetchWithConcurrency(fetchFn),
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message.includes("(authentication required?)"), "401 hint in consolidated error");
}

async function testSpaHtmlZarrJsonFallsBackToZmetadata(): Promise<void> {
  const requested: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    if (url.endsWith("/zarr.json")) {
      return new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (url.endsWith("/.zmetadata")) {
      return mockResponse(200, {
        metadata: {
          "radiance/.zarray": {
            shape: [1, 2, 2],
            chunks: [1, 2, 2],
            dtype: "<f4",
          },
        },
      });
    }
    return mockResponse(404);
  }) as typeof fetch;

  const result = await fetchConsolidatedMetadata(storeBase, undefined, {
    fetch: wrapFetchWithConcurrency(fetchFn),
  });
  assert(Object.keys(result.consolidated).includes("radiance"), "v2 consolidated parsed after SPA html");
  assert(requested.some((url) => url.endsWith("/.zmetadata")), ".zmetadata requested after html zarr.json");
}

await testV3UsesZarrJsonOnly();
await testV2FallbackToZmetadata();
await test401IncludesAuthHint();
await testSpaHtmlZarrJsonFallsBackToZmetadata();

console.log("store_connect.test.ts: ok");
