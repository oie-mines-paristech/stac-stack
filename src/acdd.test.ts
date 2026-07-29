import { partitionAttributes, variableDisplayName } from "./acdd.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  variableDisplayName({ long_name: "2 metre temperature" }, "t2m") === "2 metre temperature",
  "prefers long_name",
);

assert(
  variableDisplayName({ standard_name: "air_temperature" }, "t2m") === "air_temperature",
  "falls back to standard_name",
);

assert(variableDisplayName({}, "t2m") === "t2m", "falls back to path");

const partitioned = partitionAttributes({ history: "created", title: "ERA5" });
assert(
  partitioned.primary.every(([key]) => key !== "history"),
  "history is not in primary store metadata",
);
assert(
  partitioned.extra.some(([key]) => key === "history"),
  "history is in extra store metadata",
);
assert(partitioned.primary.some(([key]) => key === "title"), "title stays primary");

console.log("acdd.test.ts: ok");
