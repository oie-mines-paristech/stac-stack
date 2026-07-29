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

## License

MIT — Copyright (c) Raphaël Jolivet - OIE - Mines Paris - PSL
