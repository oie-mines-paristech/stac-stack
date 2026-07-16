# Zarr Image Viewer

Generic browser viewer for **Zarr v3** image cubes, including **JPEG-XL** compressed arrays via the local [`jpegxl-zarr`](../jpegxl-zarr-codec) codec plugin.

## Features

- Opens Zarr v3 stores with **consolidated metadata**
- Discovers image variables and axis roles using **CF conventions** (time units, `axis` X/Y, band `names`)
- Date picker and time-of-day range filter on the time axis
- Play / Pause / Stop animation looping over a selected UTC day
- Dropdown controls for auxiliary dimensions (e.g. `bracket`)
- Metadata panel for variable and coordinate attributes

## Requirements

- Node.js 20+
- Sibling checkout of [`jpegxl-zarr-codec`](../jpegxl-zarr-codec) (linked via `file:` dependency)

## Local development

The viewer depends on the sibling checkout via `file:../jpegxl-zarr-codec`. Vite is configured to allow that path (`server.fs.allow` in `vite.config.ts`).

```bash
# Build the codec first
cd ../jpegxl-zarr-codec
npm install
npm run build

# Run the viewer
cd ../zarr-viewer
npm install
npm run dev
```

Open the default demo store:

```
http://localhost:5173/?url=https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/
```

## CF axis tagging (recommended)

| Role | Coordinate variable attributes |
|---|---|
| **Time** | `units: "seconds since 1970-01-01 00:00:00"`, `standard_name: "time"`, optional `frequency: "PT15M"` |
| **X / Y** | `axis: "X"` / `"Y"`, or `standard_name: projection_x_coordinate` / `projection_y_coordinate`; pixel grids: `units: "1"` |
| **Band** | `names: ["R", "G1", "B", "G2"]` on the band coordinate |
| **Other** | Any 1D auxiliary coordinate (shown as a dropdown) |

When dedicated coordinate arrays are missing, the viewer falls back to `dimension_names` heuristics (`time`, `band`, `y`, `x`, `raw_y`, …).

## License

MIT — Copyright (c) Raphaël Jolivet - OIE - Mines Paris - PSL
