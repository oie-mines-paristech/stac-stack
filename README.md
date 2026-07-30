# stac-generator

Generate a [STAC](https://stacspec.org/) catalog/collection tree from a folder hierarchy that contains:

- geospatial datasets (GeoTIFF, NetCDF, Zarr)
- one `metadata.yml` per directory to declare the tree (catalogs/collections) and extra assets (PDF, thumbnails, etc.)

The generator extracts as much metadata as possible from the datasets (spatial/temporal extent, datacube metadata, and band metadata when available) and writes a STAC-compliant output tree.

## Features

- **Build a STAC tree from folders**: each directory becomes either a **Catalog** (`children`) or a **Collection** (`items`)
- **Dataset discovery via glob patterns**: `children`/`items` accept relative paths and glob patterns (resolved from the current folder)
- **Automatic Item metadata**:
  - spatial extent (WGS84 bbox + geometry)
  - temporal extent when it can be inferred; otherwise a sentinel datetime is used and the item is marked with `stac_generator:datetime_unknown: true`
- **STAC extensions / common metadata**:
  - adds **Datacube** metadata for NetCDF/Zarr when it can be inferred
  - adds band metadata as Common Metadata `bands` on assets (successor of `eo:bands`)
- **Extra assets**:
  - optional folder-level assets declared in `metadata.yml`
  - auto-detects `thumbnail.*` or `preview.*` in each folder (added as a Collection asset, or as an `icon` link for Catalogs)
- **Relative STAC links, published asset hrefs**:
  - STAC JSON files use **relative links**
  - asset `href`s are built from `--root-href` + the asset path relative to the input root

## Metadata mappings

Automatic metadata extraction happens when STAC Items are built from dataset files.
NetCDF and Zarr share the same xarray/CF code path; GeoTIFF uses rasterio.
Global discovery metadata follows [ACDD 1.3](https://wiki.esipfed.org/Attribute_Convention_for_Data_Discovery_1-3)
where applicable. STAC fields follow [Common Metadata](https://github.com/radiantearth/stac-spec/blob/master/commons/common-metadata.md).

Implementation lives in [`src/geo_metadata.py`](src/geo_metadata.py), [`src/acdd_metadata.py`](src/acdd_metadata.py),
[`src/geotiff_metadata.py`](src/geotiff_metadata.py), and [`src/stac_build.py`](src/stac_build.py).

Spatial/temporal resolution order: CF coordinates / rioxarray, then ACDD geospatial/temporal attributes, then sentinel defaults.

### Global metadata — ACDD 1.3 → STAC Item

Applies to NetCDF/Zarr global attributes (`ds.attrs`).

| Source metadata (ACDD / CF global) | STAC field |
| --- | --- |
| `title` | `properties.title` |
| `summary` | `properties.description` |
| `keywords` | `properties.keywords` (comma-separated list split into an array) |
| `id` | `id` (overrides path-derived id when valid) |
| `license` | `properties.license` (SPDX when recognized, otherwise `other`) |
| `institution` | `properties.providers[]` with role `producer` |
| `creator_name` | `properties.providers[]` with role `producer` |
| `creator_email` | `properties.providers[].description` |
| `creator_url` | `properties.providers[].url` |
| `publisher_name` | `properties.providers[]` with role `host` |
| `publisher_email` / `publisher_url` | `properties.providers[]` |
| `source`, `comment`, `acknowledgement`, `project` | appended to `properties.description` |
| `date_created` | `properties.created` |
| `date_modified` | `properties.updated` |
| `platform` | `properties.platform` |
| `instrument` | `properties.instruments[]` |
| `program` | `properties.mission` |
| `references` | `links[]` with `rel: cite-as` |
| `metadata_link` | `links[]` with `rel: describedby` |
| `license` (URL) | `links[]` with `rel: license` |
| `geospatial_lat_min/max`, `geospatial_lon_min/max` | `bbox`, `geometry` (fallback) |
| `time_coverage_start` / `time_coverage_end` | `start_datetime` / `end_datetime` (fallback) |

### NetCDF / Zarr — spatial and temporal extent

| Source metadata | STAC field |
| --- | --- |
| Coord `time` or `standard_name=time` + `units`/`calendar` | `datetime` or `start_datetime`/`end_datetime` |
| Coords `lon`/`longitude`/`x` + `lat`/`latitude`/`y` | `bbox`, `geometry` |
| `standard_name` = `longitude`, `projection_x_coordinate`, `latitude`, `projection_y_coordinate` | `bbox` |
| `ds.rio.crs` + `ds.rio.bounds()` | `bbox`, `geometry` (reprojected to WGS84) |
| Degenerate bbox (point) | `geometry` Point, expanded bbox ±100 m |
| No temporal info | `datetime=1970-01-01`, `stac_generator:datetime_unknown=true` |
| No spatial extent | `bbox=[-180,-90,180,90]` |
| Relative path | `id` |
| Path + `--root-href` | `assets.<key>.href` |
| File extension | `assets.<key>.type` |
| Filename | `assets.<key>.title`, role `data` |
| All `data_vars` + dimensions | Datacube extension, `cube:dimensions`, `cube:variables` |

### NetCDF / Zarr — dimension level (`cube:dimensions`)

| Source metadata | STAC field |
| --- | --- |
| Dim name `time`/`t` | `type: temporal` |
| Dim name `x`/`lon`/`longitude` | `type: spatial`, `axis: x` |
| Dim name `y`/`lat`/`latitude` | `type: spatial`, `axis: y` |
| Other dim name | `type: other` |
| Temporal coord + `units`/`calendar` | `extent` [ISO start, ISO end] |
| First two temporal coord values | `step` (ISO 8601 duration) |
| Spatial coord min/max | `extent` [min, max] |
| First two spatial coord values | `step` (number) |
| Dimension without coord | `extent: [0, size-1]` |

### NetCDF / Zarr — variable level (`cube:variables` + asset `bands`)

| Source metadata (CF variable attrs) | STAC field |
| --- | --- |
| `da.dims` | `cube:variables.<name>.dimensions` |
| `units` or `unit` | `cube:variables.<name>.unit`, `bands[].unit` |
| `long_name` / `standard_name` / `description` | `cube:variables.<name>.description`, `bands[].description` |
| Variable name | `bands[].name` |
| `_FillValue` / `missing_value` | `bands[].nodata` |
| `actual_range` | `bands[].statistics.minimum` / `statistics.maximum` (preferred) |
| `valid_min` / `valid_max` / `valid_range` | `bands[].statistics.minimum` / `statistics.maximum` (if no `actual_range`) |
| Variable dtype | `bands[].data_type` |

**CF valid range vs STAC statistics:** CF `valid_min`/`valid_max`/`valid_range` define acceptable values (out-of-range treated as missing).
STAC `statistics.minimum`/`maximum` describe observed value ranges. Prefer `actual_range` when present; otherwise map CF valid bounds to `statistics`.

### GeoTIFF — global level

| Source metadata (rasterio) | STAC field |
| --- | --- |
| `src.bounds` + `src.crs` | `bbox`, `geometry` (Polygon, WGS84) |
| `src.crs is None` | `bbox` (assumed WGS84) |
| No temporal metadata | `datetime=1970-01-01`, `stac_generator:datetime_unknown=true` |
| Relative path | `id`, `assets.<stem>.href`, `title`, role `data` |
| Extension | `assets.<stem>.type` |
| `TIFFTAG_IMAGEDESCRIPTION` / `IMAGE_DESCRIPTION` | `properties.description` |

### GeoTIFF — band level

GeoTIFF has no standard band name field; GDAL band descriptions and tags are used.

| Source metadata (rasterio / GDAL) | STAC field |
| --- | --- |
| `src.descriptions[i]` | `bands[i].description` |
| Short description / `colorinterp` / band index | `bands[i].name` |
| `src.nodata` / `src.nodatavals[i]` | `bands[i].nodata` |
| `src.dtypes[i]` | `bands[i].data_type` |
| Band tags `STATISTICS_MINIMUM` / `STATISTICS_MAXIMUM` | `bands[i].statistics.minimum` / `statistics.maximum` |
| Band tags `STATISTICS_MEAN` / `STATISTICS_STDDEV` | `bands[i].statistics.mean` / `statistics.stddev` |
| Band tags `unit` / `units` | `bands[i].unit` |

### Not mapped

- `Conventions`, `standard_name_vocabulary`, audit-only `history`
- `grid_mapping` (may appear as a datacube variable)
- `scale_factor` / `add_offset` (handled by xarray decoding)
- Vendor-specific GeoTIFF/GDAL dataset tags
- EO extension fields (`eo:bands`, etc.)

## Running tests

End-to-end regression tests generate small NetCDF, Zarr, and GeoTIFF fixtures, run `generate-stac`, and assert STAC output mappings.

```bash
uv sync --group dev
make test
```

## Installation

This project is managed with `uv`.

```bash
uv sync
```

## CLI usage

The CLI is called `generate-stac` and requires:

- `--input`: input root folder (must contain a `metadata.yml` at the root)
- `--output`: output folder (created if needed)
- `--root-href`: HTTP prefix used to build asset `href`s (example: `http://site.tld/path/`)

Example:

```bash
uv run generate-stac \
  --input /path/to/root-folder \
  --output /path/to/out-folder \
  --root-href "http://site.tld/path/"
```

Watch mode (regenerate on changes):

```bash
uv run generate-stac \
  --input /path/to/root-folder \
  --output /path/to/out-folder \
  --root-href "http://site.tld/path/" \
  --watch \
  --watch-debounce 10
```

If you prefer running the script directly:

```bash
uv run python main.py \
  --input /path/to/root-folder \
  --output /path/to/out-folder \
  --root-href "http://site.tld/path/"
```

## Logs, status file, and atomic output

Each generation attempt:

- prints a few lines on stdout (start/end + duration)
- writes a `status.log` file in the output directory:
  - `OK` on success
  - `ERROR` + stack trace on failure (with context: input/output)

In watch mode, errors are caught and the watcher continues running.

To avoid leaving a half-written catalog, the generator writes to a temporary directory and only
replaces the output directory on success.

## Docker

This repository ships with a `Dockerfile` and an entrypoint that automatically runs `generate-stac` in `--watch` mode
and **restarts it if it crashes**.

### Environment variables

The container is configured via environment variables:

- `INPUT_DIR` (default: `/data/in`): passed to `--input`
- `OUTPUT_DIR` (default: `/data/catalog`): passed to `--output`
- `ROOT_HREF` (default: `/root`): passed to `--root-href`
- `WATCH_DEBOUNCE` (default: `10`): passed to `--watch-debounce`

### Recommended volume mounts

The Docker image **does not include the `data/` directory** (see `.dockerignore`).
Mount your data at runtime, for example by mounting the whole `./data` directory:

- `./data:/data` (so the defaults `INPUT_DIR=/data/in` and `OUTPUT_DIR=/data/catalog` work out of the box)

### docker-compose example

```yaml
services:
  stac:
    build: .
    image: stac-generator:dev
    environment:
      INPUT_DIR: /data/in
      OUTPUT_DIR: /data/catalog
      ROOT_HREF: /root
      WATCH_DEBOUNCE: "10"
    volumes:
      - ./data:/data
```

## Writing `metadata.yml`

### Key idea

Every directory that participates in the STAC tree **must** contain a `metadata.yml`.  
The presence of either:

- `children` makes the folder a **STAC Catalog**
- `items` makes the folder a **STAC Collection**

`children` and `items` are **mutually exclusive**, and **one of them is required**.

### Supported fields

`metadata.yml` supports the following fields (unknown fields are rejected):

- `id` (optional): STAC id. Defaults to the directory path relative to the root (`root` for the root folder).
- `title` (optional): defaults to the folder name.
- `description` (optional): defaults to `title`.
- `children` (catalog only): list of relative directory paths and/or glob patterns.
- `items` (collection only): list of relative file/directory paths and/or glob patterns. Zarr stores must end with `.zarr`.
- `assets` (optional): list of extra assets to attach to the Catalog/Collection.
  - as a **string**: `"asset1.pdf"` (role + name default to the filename stem)
  - as an **object**:
    - `file`: relative path to the asset
    - `roles`: list of STAC roles
    - `name` (optional): asset key in STAC (defaults to filename stem)
    - `mime` (optional): media type (guessed from extension if missing)

### Patterns (`children` / `items`)

- Patterns are resolved with globbing relative to the folder that contains the `metadata.yml`.
- If a pattern does not match anything, the generator also tries it as a direct relative path.
- All resolved entries must stay under the input root folder.

### Examples

Collection example:

```yml
id: collection-1
title: A collection
description: Example collection containing datasets
items:
  - img_*.tif
  - *.nc
  - subfolder/*.zarr
assets:
  - asset1.pdf
  - file: docs/spec.pdf
    roles: ["documentation"]
    name: spec
```

Catalog example:

```yml
id: catalog-1
title: A catalog
description: Example catalog pointing to sub-collections
children:
  - ./collection1
  - ./collection2
  - ./other-collections*/
assets:
  - file: overview.pdf
    roles: ["overview"]
    name: overview
```

## Output layout

The output directory mirrors the input tree:

- Catalog folders contain `catalog.json`
- Collection folders contain `collection.json`
- Collection items are stored under `<collection>/items/<item-id>.json`

All links between STAC JSON files are written as relative published links, while dataset/asset hrefs are built using `--root-href`.

## More details

See `INSTRUCTIONS.md` for additional background and examples.

