from __future__ import annotations

from pathlib import Path


def guess_mime_type(path: Path) -> str | None:
    ext = path.suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".tif" or ext == ".tiff" or ext in {".geotiff", ".gtiff"}:
        return "image/tiff; application=geotiff"
    if ext == ".nc" or ext == ".netcdf":
        return "application/x-netcdf"
    if ext == ".zarr":
        # Zarr est un répertoire, mais on peut lui associer un type logique.
        return "application/vnd+zarr"
    if ext == ".pdf":
        return "application/pdf"
    if ext == ".json":
        return "application/json"
    if ext in {".yml", ".yaml"}:
        return "application/yaml"
    return None

