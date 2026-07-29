import {
  beginChunkLoad,
  endChunkLoad,
  getChunkProgress,
  normalizeChunkProgressKey,
  recordChunkKey,
  wrapFetchWithConcurrency,
} from "./chunk_progress.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  normalizeChunkProgressKey("https://example.com/data/c/0/1/2") === "/data/c/0/1/2",
  "normalize URL to pathname",
);

beginChunkLoad({ label: "test", expectedChunks: 3, expectedBytes: 300, expectedNetworkBytes: 900 });
recordChunkKey("https://example.com/c/0/1/2", 100);
recordChunkKey("https://example.com/c/0/1/2", 100);
recordChunkKey("/c/0/1/3", 50);
const snap = getChunkProgress();
assert(snap.completed === 2, `dedup chunk keys, got ${snap.completed}`);
assert(snap.receivedBytes === 150, `sum bytes, got ${snap.receivedBytes}`);
assert(snap.expectedNetworkBytes === 900, "expected network bytes preserved");
endChunkLoad();
assert(!getChunkProgress().active, "session cleared");

let inFlight = 0;
let maxInFlight = 0;
const baseFetch: typeof fetch = async () => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 30));
  inFlight--;
  return new Response("", { status: 200, headers: { "content-length": "64" } });
};

beginChunkLoad({ label: "fetch", expectedChunks: 8, expectedBytes: 512, expectedNetworkBytes: 2048 });
const limitedFetch = wrapFetchWithConcurrency(baseFetch);
await Promise.all(
  Array.from({ length: 8 }, (_, i) => limitedFetch(`https://example.com/c/${i}/0/0`)),
);
assert(maxInFlight <= 4, `fetch concurrency capped at 4, saw ${maxInFlight}`);
assert(getChunkProgress().completed === 8, "recorded all chunk fetches");
endChunkLoad();

console.log("chunk_progress.test.ts: ok");
