import {
  coastlineLayout,
  displayRow,
  isLatLonVariable,
  shouldFlipYAxis,
} from "./spatial.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  !shouldFlipYAxis([90, 45, 0, -45, -90], { stored_direction: "decreasing" }),
  "decreasing metadata with decreasing values: no flip",
);

assert(
  shouldFlipYAxis([-90, 0, 90], { stored_direction: "decreasing" }),
  "decreasing metadata with increasing values: flip",
);

assert(
  shouldFlipYAxis([90, 0, -90], { stored_direction: "increasing" }),
  "increasing metadata with decreasing values: flip",
);

assert(
  !shouldFlipYAxis([-90, 0, 90], { stored_direction: "increasing" }),
  "increasing metadata with increasing values: no flip",
);

assert(
  shouldFlipYAxis([-90, 0, 90], {}),
  "fallback: ascending values flip",
);

assert(
  !shouldFlipYAxis([90, 0, -90], {}),
  "fallback: descending values no flip",
);

assert(displayRow(0, 10, false) === 0, "displayRow no flip");
assert(displayRow(0, 10, true) === 9, "displayRow flipped");

assert(
  isLatLonVariable({
    axes: [
      { name: "longitude", role: "x" },
      { name: "latitude", role: "y" },
    ],
  }),
  "detects lat/lon axes",
);

assert(
  !isLatLonVariable({
    axes: [
      { name: "x", role: "x" },
      { name: "y", role: "y" },
    ],
  }),
  "rejects non-geographic axes",
);

const era5 = coastlineLayout({ xValues: [0, 360], yValues: [90, -90], flipY: false });
assert(era5.viewBox === "0 0 360 180", "coastline viewBox for global 0-360 grid");
assert(era5.shiftX === 180, "0-360 grid shifts coastlines by 180°");
assert(!era5.flipY, "north-at-top latitude: no overlay flip");

const lon180 = coastlineLayout({
  xValues: [-180, 180],
  yValues: [90, -90],
  flipY: false,
});
assert(lon180.viewBox === "0 0 360 180", "coastline viewBox for global -180..180 grid");
assert(lon180.shiftX === 0, "-180..180 grid needs no shift");

const southUp = coastlineLayout({ xValues: [0, 360], yValues: [-90, 90], flipY: false });
assert(southUp.flipY, "south-at-top latitude: overlay flip");

console.log("spatial.test.ts: ok");
