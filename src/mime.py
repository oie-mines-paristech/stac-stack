from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ZARR_EXTENSION_HREF = "https://stac-extensions.github.io/zarr/v1.1.0/schema.json"


def is_zarr_store(path: Path) -> bool:
    return path.is_dir() and path.name.lower().endswith(".zarr")


def zarr_store_metadata(path: Path) -> dict[str, Any]:
    """Metadata STAC Zarr (best practices) dérivée du store sur disque."""
    zarr_json = path / "zarr.json"
    if zarr_json.is_file():
        data = json.loads(zarr_json.read_text(encoding="utf-8"))
        zarr_format = int(data.get("zarr_format", 3))
        node_type = str(data.get("node_type", "group"))
        consolidated = bool(data.get("consolidated_metadata")) or (path / ".zmetadata").is_file()
        return {
            "zarr_format": zarr_format,
            "node_type": "group" if node_type == "group" else "array",
            "consolidated": consolidated,
        }

    if (path / ".zgroup").is_file():
        return {
            "zarr_format": 2,
            "node_type": "group",
            "consolidated": (path / ".zmetadata").is_file(),
        }

    return {"zarr_format": 3, "node_type": "group", "consolidated": False}


def guess_mime_type(path: Path) -> str | None:
    if is_zarr_store(path):
        meta = zarr_store_metadata(path)
        return f"application/vnd.zarr; version={meta['zarr_format']}"

    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".tif" or ext == ".tiff" or ext in {".geotiff", ".gtiff"}:
        return "image/tiff; application=geotiff"
    if ext == ".nc" or ext == ".netcdf":
        return "application/x-netcdf"
    if ext == ".pdf":
        return "application/pdf"
    if ext == ".json":
        return "application/json"
    if ext in {".yml", ".yaml"}:
        return "application/yaml"
    return None
