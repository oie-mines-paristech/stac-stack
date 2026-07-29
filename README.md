# Zarr Image Viewer

Generic browser viewer for **Zarr v2/v3** image cubes, including **JPEG-XL** compressed arrays via the [`@oie-minesparis-psl/jpegxl-zarr`](https://www.npmjs.com/package/@oie-minesparis-psl/jpegxl-zarr) codec plugin.

## Features

- Opens Zarr v2/v3 stores with **consolidated metadata** (`.zmetadata` or inline `zarr.json`)
- **Authenticated stores**: Basic auth (login/password in store URL) or Bearer token (`Authorization` header)
- Discovers image variables and axis roles using **CF conventions** (time units, `axis` X/Y, band `names`)
- Supports **latitude/longitude** (and `lat`/`lon`) as spatial image axes
- Date picker and time-of-day range filter on the time axis
- Play / Pause / Stop animation looping over a selected UTC day
- Dropdown controls for auxiliary dimensions (e.g. `bracket`)
- Metadata panel for variable and coordinate attributes

## Requirements

- Node.js 20+

## Local development

```bash
npm install
npm run dev
```

No dataset is loaded by default. Open a store via the **Store URL** field or a query parameter:

```
http://localhost:5173/?url=/stac/data/fisheye/sophia.zarr/
http://localhost:5173/?url=https://demos.oie-lab.net/stac/data/fisheye/sophia.zarr/
```

Path-only URLs such as `/stac/data/...` are resolved against the current page origin (scheme, host, and port).

Run unit tests:

```bash
npm run test:unit
```

## Authenticated stores

Click the **key icon** next to the Store URL field to configure credentials.

| Mode | Viewer URL encoding | HTTP |
|------|---------------------|------|
| **Basic** | `?url=https://user:pass@host/path/` | `Authorization: Basic …` header (URL userinfo for sharing only) |
| **Bearer** | `?url=https://host/path/&auth=bearer:<token>` | `Authorization: Bearer <token>` header |

The viewer URL in the address bar is updated automatically so a copied link reproduces the same access (including credentials).

**Security note:** credentials in URLs are visible in browser history, server logs, and to anyone who receives the link. Use only for trusted sharing contexts.

Example Bearer URL:

```
http://localhost:5173/?url=https://example.com/data.zarr/&auth=bearer:YOUR_TOKEN
```

Cross-origin stores must expose appropriate **CORS** headers (including `Authorization` when using Bearer tokens). Same-origin stores (e.g. `/stac/data/...` on the same host) work with a **static deployment** (`npm run build` → serve `dist/`).

When CORS blocks a remote store (e.g. Earth Data Hub), the viewer **retries via a same-origin proxy** only if `VITE_ZARR_PROXY` was set at build time. Otherwise it shows an explicit error: static deployment cannot reach that remote resource.

| Deployment | Proxy client (`VITE_ZARR_PROXY`) | Proxy server |
|------------|----------------------------------|--------------|
| Static only (`npm run build`) | off (default) | none — remote stores need CORS on the upstream |
| Dev (`npm run dev`) | `./proxy/` (automatic) | Vite middleware in [`vite.config.ts`](vite.config.ts) |
| Docker Compose | `./proxy/` (Dockerfile) | [`nginx/default.conf`](nginx/default.conf) |

Example proxied request (browser → nginx/Vite → upstream):

```
/stac/viewer/proxy/https/api.earthdatahub.destine.eu/climate-dt-2/.../zarr.json
```

The proxy path encodes scheme, host, and path dynamically — no hardcoded upstream domain. `Authorization` (Basic or Bearer) is forwarded to the remote server.

## CF axis tagging (recommended)

| Role | Coordinate variable attributes |
|---|---|
| **Time** | `units: "seconds since 1970-01-01 00:00:00"`, `standard_name: "time"`, optional `frequency: "PT15M"` |
| **X / Y** | `axis: "X"` / `"Y"`, or `standard_name: projection_x_coordinate` / `projection_y_coordinate` / `longitude` / `latitude`; pixel grids: `units: "1"` |
| **Band** | `names: ["R", "G1", "B", "G2"]` on the band coordinate |
| **Other** | Any 1D auxiliary coordinate (shown as a dropdown) |

When dedicated coordinate arrays are missing, the viewer falls back to `dimension_names` heuristics (`time`, `band`, `latitude`, `longitude`, `lat`, `lon`, `y`, `x`, …).

## Chunk access pattern

A **full spatial frame** (one time step, full latitude/longitude extent) reads one Zarr chunk per grid tile along each axis. The number of HTTP chunk requests is the product of chunk counts along time (fixed index), Y, and X — not the total array size.

Example (Earth Data Hub–style): shape `[306816, 4096, 8193]`, `chunk_shape` `[24, 512, 512]` → **136 chunks** per frame (`1 × 8 × 17` spatial tiles; longitude needs 17 tiles because 8193 is not a multiple of 512). Logical decode size is ~128 MiB per frame (float32); on the wire you fetch compressed chunk files (Blosc/Zstd).

**Prefetch** for a UTC day loads the **union** of chunk keys across all time steps in that day. If the time chunk covers 24 hourly steps (chunk time size ≥ 24), a full day still needs ~136 unique chunk files — not 24×136. Already-fetched chunks are served from the shared **byte cache** (`zarrita.withByteCaching`), so frames after the first load reuse network data.

Before a heavy load, the viewer estimates **image chunk count**, **on-wire volume** (full Zarr chunk files, including e.g. 24 time steps per spatial chunk on EDH-style stores), and **decoded frame size**. When thresholds are exceeded (50 chunks or 50 MiB):

- **Multi-tile spatial chunking** (e.g. EDH `8×17` tiles): a **spatial region picker** opens — click one cell or drag a rectangle, then **Load selected area**. An estimate (chunk count, decoded size, on-wire size) appears under the grid; it turns **orange with a warning** if the selection still exceeds recommended limits (50 chunks / 50 MiB). Full-frame **Continue** is not offered (would fetch ~GB on the wire and crash the browser).
- **Single spatial tile** (heavy due to time/band/coords, not spatial tiling): classic **Continue** / **Dismiss** dialog — full frame load is allowed with warning.

The chosen spatial region stays active for the session (time steps change without re-opening the dialog; variable changes keep the same region when the grid is compatible). It is also persisted in the **URL hash** as `region: [y0, y1, x0, x1]`. Use **Change area…** in the status bar to pick another region. Background prefetch is disabled while a region is active.

Example classic warning:

*Requested 136 chunks (~1.3 GB on wire) for a 128 MB frame: This dataset doesn't seem optimized for image preview. Are you sure you want to continue?*

**Coordinate arrays** (time, lat, lon, …) are loaded in full at variable selection (with multi-chunk fallback). **Image planes** validate assembled shape and fall back to tile-by-tile reads if needed.

During fetch, `#status` shows progress (`Loading… 37/136 chunks · …`). HTTP chunk requests are limited to **4 concurrent** fetches globally. Background prefetch does not reset the progress counter.

**Coastlines** require a lat/lon variable with 1D coordinate arrays whose length matches the image width and height. Coastlines are warped from [`public/coastlines.svg`](public/coastlines.svg) via lon/lat lookup (works for regular and irregular 1D grids). The spatial chunk picker shows a coastlines mini-map when coordinates are available.

## License

MIT — Copyright (c) Raphaël Jolivet - OIE - Mines Paris - PSL
