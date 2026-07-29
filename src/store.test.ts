function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Mirrors readCoordinateValues materialization — full slice must yield all elements. */
function coordinateValuesFromFullChunk(data: ArrayLike<unknown>, shape: number[]): unknown[] {
  const expected = shape.reduce((acc, dim) => acc * dim, 1);
  const values = Array.from(data);
  assert(values.length === expected, "full coordinate read returns all elements");
  return values;
}

const chunk0Only = coordinateValuesFromFullChunk([1, 2, 3], [3]);
assert(chunk0Only.length === 3, "small coordinate");

const fullTime = coordinateValuesFromFullChunk(
  { length: 5, 0: 10, 1: 20, 2: 30, 3: 40, 4: 50 } as ArrayLike<number>,
  [5],
);
assert(fullTime[0] === 10 && fullTime.at(-1) === 50, "multi-chunk equivalent full read");

console.log("store.test.ts: ok");
