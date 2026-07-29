import {
  defaultDayFromDates,
  defaultTimeIndexForDay,
  timeIndicesSearchOrder,
} from "./time.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const day1 = new Date("2024-01-01T12:00:00Z");
const day2 = new Date("2024-01-02T12:00:00Z");
assert(defaultDayFromDates([day1, day2]) === "2024-01-01", "default day is first");

const indices = [10, 11, 12, 13, 14];
assert(defaultTimeIndexForDay(indices) === 12, "middle index for odd length");
assert(defaultTimeIndexForDay([7, 8]) === 8, "middle index for even length");

const order = timeIndicesSearchOrder([10, 11, 12, 13, 14]);
assert(order[0] === 12, "search starts at middle");
assert(order.includes(11) && order.includes(13), "search includes neighbors");
assert(order.length === 5, "search covers all indices");

console.log("time.test.ts: ok");
