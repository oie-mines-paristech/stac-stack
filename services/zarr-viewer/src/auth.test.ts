import {
  applyAuthToUrl,
  basicAuthHeader,
  createAuthFetch,
  parseAuthFromUrl,
  parseAuthParam,
  parseBasicAuthParam,
  parseBearerAuthParam,
  resolveStoreAuth,
  serializeAuthParam,
  serializeBasicAuthParam,
  serializeBearerAuthParam,
  storeUrlForFetch,
  stripAuthFromUrl,
} from "./auth.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  parseBearerAuthParam("bearer:abc-123")?.kind === "bearer" &&
    (parseBearerAuthParam("bearer:abc-123") as { token: string }).token === "abc-123",
  "parseBearerAuthParam",
);

assert(parseBearerAuthParam("basic:user") === undefined, "reject non-bearer auth param");

assert(
  serializeBearerAuthParam({ kind: "bearer", token: "tok" }) === "bearer:tok",
  "serializeBearerAuthParam",
);

assert(
  parseBasicAuthParam("basic:alice:secret")?.kind === "basic" &&
    (parseBasicAuthParam("basic:alice:secret") as { username: string }).username === "alice" &&
    (parseBasicAuthParam("basic:alice:secret") as { password: string }).password === "secret",
  "parseBasicAuthParam",
);

assert(
  serializeBasicAuthParam({ kind: "basic", username: "alice", password: "p@ss:word" }) ===
    "basic:alice:p%40ss%3Aword",
  "serializeBasicAuthParam encodes special chars",
);

assert(
  parseAuthParam("basic:alice:p%40ss%3Aword")?.kind === "basic" &&
    (parseAuthParam("basic:alice:p%40ss%3Aword") as { password: string }).password === "p@ss:word",
  "parseAuthParam round-trip basic",
);

assert(
  serializeAuthParam({ kind: "basic", username: "bob", password: "pw" }) === "basic:bob:pw",
  "serializeAuthParam basic",
);

const basicUrl = applyAuthToUrl("https://example.com/store.zarr/", {
  kind: "basic",
  username: "alice",
  password: "secret",
});
assert(basicUrl.includes("alice") && basicUrl.includes("secret"), "applyAuthToUrl embeds credentials");

const parsedBasic = parseAuthFromUrl(new URL(basicUrl));
assert(parsedBasic?.kind === "basic" && parsedBasic.username === "alice", "parseAuthFromUrl round-trip");

const stripped = stripAuthFromUrl(basicUrl);
assert(!stripped.includes("alice") && stripped.startsWith("https://"), "stripAuthFromUrl removes userinfo");

assert(
  !storeUrlForFetch(basicUrl, { kind: "basic", username: "bob", password: "pw" }).includes("bob"),
  "storeUrlForFetch strips credentials from fetch URL",
);

assert(
  storeUrlForFetch(basicUrl, { kind: "basic", username: "bob", password: "pw" }) ===
    "https://example.com/store.zarr/",
  "storeUrlForFetch returns clean URL",
);

assert(
  basicAuthHeader("edh", "key_abc") === `Basic ${btoa("edh:key_abc")}`,
  "basicAuthHeader",
);

assert(
  storeUrlForFetch("https://host/data.zarr/", { kind: "bearer", token: "x" }) ===
    "https://host/data.zarr/",
  "storeUrlForFetch keeps bearer URL clean",
);

assert(
  resolveStoreAuth("https://u:p@host/data.zarr/", null)?.kind === "basic",
  "resolveStoreAuth from userinfo",
);

assert(
  resolveStoreAuth("https://host/data.zarr/", "bearer:tok")?.kind === "bearer",
  "resolveStoreAuth bearer param wins",
);

assert(
  resolveStoreAuth("https://host/data.zarr/", "basic:alice:secret")?.kind === "basic",
  "resolveStoreAuth basic param",
);

async function testBearerFetch(): Promise<void> {
  let bearerHeader = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    const request = new Request(input, init);
    bearerHeader = request.headers.get("Authorization") ?? "";
    return Promise.resolve(new Response("ok"));
  }) as typeof fetch;

  await createAuthFetch({ kind: "bearer", token: "my-token" })("https://example.com/");
  assert(bearerHeader === "Bearer my-token", "createAuthFetch sets Bearer Authorization header");
  globalThis.fetch = previousFetch;
}

async function testBasicFetch(): Promise<void> {
  let basicHeader = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((input, init) => {
    const request = new Request(input, init);
    basicHeader = request.headers.get("Authorization") ?? "";
    return Promise.resolve(new Response("ok"));
  }) as typeof fetch;

  await createAuthFetch({ kind: "basic", username: "edh", password: "secret-key" })(
    "https://example.com/zarr.json",
  );
  assert(
    basicHeader === basicAuthHeader("edh", "secret-key"),
    "createAuthFetch sets Basic Authorization header",
  );
  globalThis.fetch = previousFetch;
}

await testBearerFetch();
await testBasicFetch();

console.log("auth.test.ts: ok");
