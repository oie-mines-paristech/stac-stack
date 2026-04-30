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

