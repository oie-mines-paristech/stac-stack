import {
  defaultDayFromDates,
  defaultTimeIndexForDay,
  inferTimeStepMs,
  supportsIntraDayTimePlayback,
  timeIndicesSearchOrder,
  timeValuesToDates,
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

const hourly = [
  new Date("2024-06-16T00:00:00Z"),
  new Date("2024-06-16T01:00:00Z"),
  new Date("2024-06-16T02:00:00Z"),
];
assert(inferTimeStepMs(hourly) === 3_600_000, "hourly step inferred from first pair");
assert(supportsIntraDayTimePlayback(hourly), "hourly axis supports intra-day playback");

const daily = [
  new Date("2024-06-16T12:00:00Z"),
  new Date("2024-06-17T12:00:00Z"),
  new Date("2024-06-18T12:00:00Z"),
];
assert(inferTimeStepMs(daily) === 86_400_000, "daily step inferred from first pair");
assert(!supportsIntraDayTimePlayback(daily), "daily axis hides intra-day playback");

const fromUnits = timeValuesToDates([0, 3600, 7200], "seconds since 2024-06-16 00:00:00");
assert(inferTimeStepMs(fromUnits) === 3_600_000, "CF seconds-since units produce hourly step");
assert(supportsIntraDayTimePlayback(fromUnits), "CF hourly axis supports playback");

console.log("time.test.ts: ok");
