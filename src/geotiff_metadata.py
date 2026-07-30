from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.enums import ColorInterp


def _numpy_dtype_to_stac(dtype: np.dtype) -> str | None:
    mapping = {
        "int8": "int8",
        "int16": "int16",
        "int32": "int32",
        "int64": "int64",
        "uint8": "uint8",
        "uint16": "uint16",
        "uint32": "uint32",
        "uint64": "uint64",
        "float16": "float16",
        "float32": "float32",
        "float64": "float64",
    }
    return mapping.get(dtype.name)


def _band_name(*, index: int, description: str | None, colorinterp: ColorInterp | None) -> str:
    if description:
        short = description.strip()
        if len(short) <= 32 and " " not in short:
            return short
        token = short.split(":")[0].strip()
        if token and len(token) <= 32:
            return token.replace(" ", "_")
    if colorinterp is not None and colorinterp != ColorInterp.undefined:
        return colorinterp.name
    return f"B{index:02d}"


def _parse_float_tag(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def bands_from_geotiff(path: Path) -> list[dict[str, Any]]:
    bands: list[dict[str, Any]] = []
    with rasterio.Env():
        with rasterio.open(path) as src:
            descriptions = src.descriptions or [None] * src.count
            for idx in range(1, src.count + 1):
                description = descriptions[idx - 1]
                colorinterp = src.colorinterp[idx - 1] if src.colorinterp else None
                entry: dict[str, Any] = {
                    "name": _band_name(index=idx, description=description, colorinterp=colorinterp),
                }
                if description:
                    entry["description"] = description

                nodata = None
                if src.nodatavals:
                    nodata = src.nodatavals[idx - 1]
                elif src.nodata is not None:
                    nodata = src.nodata
                if nodata is not None:
                    entry["nodata"] = nodata

                data_type = _numpy_dtype_to_stac(np.dtype(src.dtypes[idx - 1]))
                if data_type:
                    entry["data_type"] = data_type

                tags = src.tags(ns=None, bidx=idx)
                stats: dict[str, float] = {}
                if (vmin := _parse_float_tag(tags.get("STATISTICS_MINIMUM"))) is not None:
                    stats["minimum"] = vmin
                if (vmax := _parse_float_tag(tags.get("STATISTICS_MAXIMUM"))) is not None:
                    stats["maximum"] = vmax
                if (mean := _parse_float_tag(tags.get("STATISTICS_MEAN"))) is not None:
                    stats["mean"] = mean
                if (stddev := _parse_float_tag(tags.get("STATISTICS_STDDEV"))) is not None:
                    stats["stddev"] = stddev
                if stats:
                    entry["statistics"] = stats

                unit = tags.get("unit") or tags.get("units")
                if unit:
                    entry["unit"] = str(unit)

                bands.append(entry)
    return bands


def geotiff_dataset_tags(path: Path) -> dict[str, str]:
    with rasterio.Env():
        with rasterio.open(path) as src:
            return dict(src.tags())
