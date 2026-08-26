import {
  defaultDayFromDates,
  defaultDayFromDatesLast,
  defaultTimeIndexForDay,
  defaultTimeIndexForDayFirst,
  defaultTimeIndexForDayLast,
  defaultTimeIndexForAxis,
  formatTimeStepLabel,
  inferTimeStepMs,
  supportsIntraDayTimePlayback,
  timeIndicesChunkProbeOrder,
  timeIndicesGlobalBackwardOrder,
  timeIndicesSearchOrder,
  timeValuesToDates,
} from "./time.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const day1 = new Date("2024-01-01T12:00:00Z");
const day2 = new Date("2024-01-02T12:00:00Z");
assert(defaultDayFromDates([day1, day2]) === "2024-01-01", "default day is first");
assert(defaultDayFromDatesLast([day1, day2]) === "2024-01-02", "default last day is last");

const indices = [10, 11, 12, 13, 14];
assert(defaultTimeIndexForDay(indices) === 12, "middle index for odd length");
assert(defaultTimeIndexForDayLast(indices) === 14, "last index for day");
assert(defaultTimeIndexForDay([7, 8]) === 8, "middle index for even length");
assert(defaultTimeIndexForDayLast([7, 8]) === 8, "last index for even length day");
assert(defaultTimeIndexForDayFirst(indices) === 10, "first index for day");
assert(defaultTimeIndexForDayFirst([7, 8]) === 7, "first index for even length day");

const hourlyDay = [
  new Date("2024-06-16T00:00:00Z"),
  new Date("2024-06-16T01:00:00Z"),
  new Date("2024-06-16T02:00:00Z"),
  new Date("2024-06-17T00:00:00Z"),
];
const lastDayIndices = [3];
assert(
  defaultTimeIndexForAxis(hourlyDay, [0, 1, 2]) === 0,
  "sub-daily default uses first step of selected day",
);
assert(
  defaultTimeIndexForAxis(hourlyDay, lastDayIndices) === 3,
  "daily cadence default uses last step of selected day",
);

const order = timeIndicesSearchOrder([10, 11, 12, 13, 14]);
assert(order[0] === 12, "search starts at middle");
assert(order.includes(11) && order.includes(13), "search includes neighbors");
assert(order.length === 5, "search covers all indices");

const backward = timeIndicesGlobalBackwardOrder(500, 10);
assert(backward[0] === 499, "global backward starts at last index");
assert(backward.includes(490), "global backward walks backward");
assert(backward.length === 10, "global backward respects limit");

const chunkProbe = timeIndicesChunkProbeOrder(2856, 96, 2855);
assert(chunkProbe[0] === 2855, "chunk probe starts at chunk end");
assert(chunkProbe.includes(2784), "chunk probe includes chunk start");
assert(chunkProbe.indexOf(2855) < chunkProbe.indexOf(2784), "end before start within chunk");

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

const quarterHour = new Date("2024-06-16T09:15:00Z");
assert(
  formatTimeStepLabel(quarterHour, 900_000) === "09:15 UTC",
  "sub-hourly step shows minutes",
);
assert(
  formatTimeStepLabel(new Date("2024-06-16T09:00:00Z"), 3_600_000) === "9H UTC",
  "hourly step shows hour only",
);

console.log("time.test.ts: ok");
