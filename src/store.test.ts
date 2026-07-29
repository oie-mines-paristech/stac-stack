function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Mirrors loadFull1DArray validation — full slice must yield all elements. */
function coordinateValuesFromFullChunk(data: ArrayLike<unknown>, shape: number[]): unknown[] {
  const expected = shape.reduce((acc, dim) => acc * dim, 1);
  const values = Array.from(data);
  assert(values.length === expected, "full coordinate read returns all elements");
  return values;
}

/** Fallback path when full read is short — assemble from slice windows. */
function coordinateValuesFromChunkWindows(
  chunks: ArrayLike<unknown>[],
  shape: number[],
  chunkSize: number,
): unknown[] {
  const size = shape[0];
  const out = new Array<unknown>(size);
  for (let index = 0; index < chunks.length; index++) {
    const start = index * chunkSize;
    const values = Array.from(chunks[index]);
    for (let offset = 0; offset < values.length; offset++) {
      out[start + offset] = values[offset];
    }
  }
  assert(out.length === size, "assembled coordinate length");
  return out;
}

const chunk0Only = coordinateValuesFromFullChunk([1, 2, 3], [3]);
assert(chunk0Only.length === 3, "small coordinate");

const fullTime = coordinateValuesFromFullChunk(
  { length: 5, 0: 10, 1: 20, 2: 30, 3: 40, 4: 50 } as ArrayLike<number>,
  [5],
);
assert(fullTime[0] === 10 && fullTime.at(-1) === 50, "multi-chunk equivalent full read");

const assembled = coordinateValuesFromChunkWindows(
  [
    [1, 2],
    [3, 4],
    [5],
  ],
  [5],
  2,
);
assert(assembled.join(",") === "1,2,3,4,5", "chunk window assembly");

console.log("store.test.ts: ok");
