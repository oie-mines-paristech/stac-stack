import {
  CorsBlockedError,
  fetchWithCorsFallback,
  isLikelyCorsError,
  parseProxyRequestPath,
  toProxyUrl,
  upstreamUrlFromProxyPath,
  zarrProxyPrefix,
} from "./proxy.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const previousWindow = globalThis.window;
globalThis.window = {
  location: {
    href: "https://demos.oie-lab.net/stac/viewer/index.html",
    origin: "https://demos.oie-lab.net",
  },
} as Window & typeof globalThis;

assert(zarrProxyPrefix() === null, "zarrProxyPrefix is null by default in tests");

assert(
  toProxyUrl(
    "https://api.earthdatahub.destine.eu/climate-dt-2/foo.zarr/zarr.json",
    "./proxy/",
  ) ===
    "https://demos.oie-lab.net/stac/viewer/proxy/https/api.earthdatahub.destine.eu/climate-dt-2/foo.zarr/zarr.json",
  "toProxyUrl rewrites cross-origin store URL",
);

const parsed = parseProxyRequestPath(
  "/stac/viewer/proxy/https/api.earthdatahub.destine.eu/climate-dt-2/foo.zarr/zarr.json",
);
assert(parsed?.host === "api.earthdatahub.destine.eu", "parseProxyRequestPath host");
assert(
  upstreamUrlFromProxyPath(
    "/proxy/https/api.earthdatahub.destine.eu/climate-dt-2/foo.zarr/c/0/0/0",
  ) === "https://api.earthdatahub.destine.eu/climate-dt-2/foo.zarr/c/0/0/0",
  "upstreamUrlFromProxyPath",
);

const crossOrigin = "https://api.earthdatahub.destine.eu/store.zarr/zarr.json";
assert(
  isLikelyCorsError(new TypeError("Failed to fetch"), crossOrigin),
  "isLikelyCorsError detects cross-origin network failure",
);
assert(
  !isLikelyCorsError(new TypeError("Failed to fetch"), "https://demos.oie-lab.net/data.zarr/"),
  "isLikelyCorsError ignores same-origin failures",
);

async function testFetchWithCorsFallback(): Promise<void> {
  let callCount = 0;
  let lastUrl = "";
  const innerFetch = (async (input: RequestInfo | URL) => {
    callCount++;
    lastUrl = input instanceof Request ? input.url : String(input);
    if (callCount === 1) {
      throw new TypeError("Failed to fetch");
    }
    return new Response("ok");
  }) as typeof fetch;

  const response = await fetchWithCorsFallback(innerFetch, "./proxy/")(crossOrigin);
  assert(response.ok, "proxy retry succeeds");
  assert(callCount === 2, "fetchWithCorsFallback retries once");
  assert(lastUrl.includes("/proxy/https/api.earthdatahub.destine.eu/"), "retry uses proxy URL");

  callCount = 0;
  let blocked: unknown;
  try {
    await fetchWithCorsFallback(innerFetch, null)(crossOrigin);
  } catch (error) {
    blocked = error;
  }
  assert(blocked instanceof CorsBlockedError, "no proxy configured throws CorsBlockedError");
  assert(callCount === 1, "no proxy retry when prefix is null");
}

await testFetchWithCorsFallback();

globalThis.window = previousWindow;

console.log("proxy.test.ts: ok");
