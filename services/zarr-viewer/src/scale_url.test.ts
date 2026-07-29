import { parseScaleParam, serializeScaleParam } from "./scale_url.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const parsed = parseScaleParam("250:310,0:100");
assert(parsed?.length === 2, "parses two bands");
assert(parsed?.[0].min === 250 && parsed?.[0].max === 310, "first band");

const roundTrip = serializeScaleParam([{ min: 250, max: 310 }]);
assert(roundTrip === "250:310", "serializes one band");
assert(parseScaleParam(roundTrip)?.[0].max === 310, "round trip");

console.log("scale_url.test.ts: ok");
