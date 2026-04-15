# stac-generator

Automatically generates a STAC catalog from a folder containing geospatial data (GeoTIFF, NetCDF, Zarr) and `metadata.yml` files.

## Installation (uv)

```bash
uv sync
```

## Utilisation

```bash
uv run generate-stac --input /path/to/root-folder --output /path/to/out-folder --root-href "http://site.tld/path/"
```

## Convention d’entrée

See `INSTRUCTIONS.md`.

