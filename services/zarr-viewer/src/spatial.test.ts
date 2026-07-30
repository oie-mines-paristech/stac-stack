import {
  canShowCoastlines,
  coastlineLayout,
  createGeoPixelMapper,
  displayRow,
  geoToAxisIndex,
  isLatLonVariable,
  isRectilinearGrid,
  longitudeSpan,
  normalizeLongitude,
  shouldFlipYAxis,
  spatialCoordsMatchPlane,
  unwrapLongitude,
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

const regional = coastlineLayout({
  xValues: [-5, 0, 5],
  yValues: [41, 46, 51],
  flipY: false,
});
assert(regional.viewBox.includes("175 "), "regional lon mapped into coastline SVG space");
assert(regional.viewBox.includes("10"), "regional width ~10 degrees");

assert(
  spatialCoordsMatchPlane({ xValues: [0, 1, 2], yValues: [10, 11] }, 3, 2),
  "coords match plane dimensions",
);
assert(
  !spatialCoordsMatchPlane({ xValues: [0, 1], yValues: [10, 11] }, 3, 2),
  "coords mismatch detected",
);

assert(
  canShowCoastlines({
    axes: [
      { name: "longitude", role: "x" },
      { name: "latitude", role: "y" },
    ],
    attributes: { GRIB_gridType: "healpix" },
  }),
  "lat/lon with healpix metadata still allows coastlines",
);

assert(
  canShowCoastlines({
    axes: [
      { name: "longitude", role: "x" },
      { name: "latitude", role: "y" },
    ],
    attributes: {},
  }),
  "rectilinear lat/lon allows coastlines",
);

assert(
  isRectilinearGrid({ attributes: { GRIB_gridType: "healpix" } }) === false,
  "healpix not rectilinear",
);

const era5Lons = Array.from({ length: 1440 }, (_, i) => (i * 360) / 1439);
const era5Lats = Array.from({ length: 721 }, (_, i) => 90 - (i * 180) / 720);
const j = geoToAxisIndex(era5Lons, era5Lons[720]!);
assert(Math.abs(j - 720) < 0.05, "geoToAxisIndex on uniform lon grid");
const i = geoToAxisIndex(era5Lats, 0);
assert(Math.abs(i - 360) < 0.05, "geoToAxisIndex on uniform lat grid");

assert(
  Math.abs(normalizeLongitude(-170, [0, 360]) - 190) < 0.001,
  "normalizeLongitude wraps into 0-360",
);

const pixelMapper = createGeoPixelMapper(era5Lons, era5Lats, false, 1440, 721);
assert(
  Math.abs(pixelMapper.lonToPixel(era5Lons[100]!) - 100) < 0.05,
  "lonToPixel on ERA5-like grid",
);
assert(
  Math.abs(pixelMapper.latToPixel(0) - 360) < 0.05,
  "latToPixel on ERA5-like grid",
);

assert(unwrapLongitude(-179, 179) === 181, "unwrapLongitude crosses dateline eastward");
assert(unwrapLongitude(179, -179) === -181, "unwrapLongitude crosses dateline westward");
assert(longitudeSpan(era5Lons) >= 350, "longitudeSpan detects global grid");

console.log("spatial.test.ts: ok");
