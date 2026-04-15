from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import rasterio
from rasterio.warp import transform_bounds
import xarray as xr


@dataclass(frozen=True)
class GeoExtent:
    bbox_wgs84: list[float]  # [minx, miny, maxx, maxy]
    start_datetime: datetime | None = None
    end_datetime: datetime | None = None


def _as_datetime_minmax(values: Any) -> tuple[datetime | None, datetime | None]:
    if values is None:
        return (None, None)
    try:
        v = xr.DataArray(values)
    except Exception:
        return (None, None)

    if v.size == 0:
        return (None, None)
    try:
        vmin = v.min().values
        vmax = v.max().values
    except Exception:
        return (None, None)

    try:
        dmin = xr.coding.times.decode_cf_datetime(vmin, units="seconds since 1970-01-01").astype("datetime64[ns]")
        dmax = xr.coding.times.decode_cf_datetime(vmax, units="seconds since 1970-01-01").astype("datetime64[ns]")
        # Fallback ci-dessus peut échouer; on tente aussi un cast direct.
        dmin = dmin.item() if hasattr(dmin, "item") else dmin
        dmax = dmax.item() if hasattr(dmax, "item") else dmax
        return (dmin, dmax)
    except Exception:
        try:
            dmin = xr.DataArray(vmin).astype("datetime64[ns]").values.item()
            dmax = xr.DataArray(vmax).astype("datetime64[ns]").values.item()
            if isinstance(dmin, datetime) and isinstance(dmax, datetime):
                return (dmin, dmax)
        except Exception:
            return (None, None)
    return (None, None)


def _guess_time_coord(ds: xr.Dataset) -> xr.DataArray | None:
    if "time" in ds.coords:
        return ds["time"]
    # Heuristique CF
    for name, c in ds.coords.items():
        std = str(c.attrs.get("standard_name", "")).lower()
        if std == "time":
            return c
    return None


def _bbox_from_lonlat(ds: xr.Dataset) -> list[float] | None:
    lon = None
    lat = None

    for cand in ("lon", "longitude", "x"):
        if cand in ds.coords:
            lon = ds.coords[cand]
            break
    for cand in ("lat", "latitude", "y"):
        if cand in ds.coords:
            lat = ds.coords[cand]
            break

    if lon is None or lat is None:
        # Heuristique via standard_name
        for name, c in ds.coords.items():
            std = str(c.attrs.get("standard_name", "")).lower()
            if std in {"longitude", "projection_x_coordinate"} and lon is None:
                lon = c
            if std in {"latitude", "projection_y_coordinate"} and lat is None:
                lat = c

    if lon is None or lat is None:
        return None

    try:
        lon_min = float(lon.min().values)
        lon_max = float(lon.max().values)
        lat_min = float(lat.min().values)
        lat_max = float(lat.max().values)
    except Exception:
        return None

    minx, maxx = (lon_min, lon_max) if lon_min <= lon_max else (lon_max, lon_min)
    miny, maxy = (lat_min, lat_max) if lat_min <= lat_max else (lat_max, lat_min)
    return [minx, miny, maxx, maxy]


def extent_from_geotiff(path: Path) -> GeoExtent:
    with rasterio.Env():
        with rasterio.open(path) as src:
            bounds = src.bounds
            crs = src.crs
            if crs is None:
                # On suppose déjà en WGS84 (au pire c’est faux, mais on évite de planter).
                bbox = [bounds.left, bounds.bottom, bounds.right, bounds.top]
            else:
                bbox = list(transform_bounds(crs, "EPSG:4326", bounds.left, bounds.bottom, bounds.right, bounds.top, densify_pts=21))
    return GeoExtent(bbox_wgs84=[float(x) for x in bbox])


def extent_from_xarray_dataset(ds: xr.Dataset) -> GeoExtent | None:
    bbox = None

    # Essai via rioxarray si dispo et si CRS connu.
    try:
        if hasattr(ds, "rio") and ds.rio.crs is not None:
            b = ds.rio.bounds()
            bbox = [float(b[0]), float(b[1]), float(b[2]), float(b[3])]
            if ds.rio.crs.to_string() not in {"EPSG:4326", "WGS84"}:
                bbox = list(transform_bounds(ds.rio.crs, "EPSG:4326", bbox[0], bbox[1], bbox[2], bbox[3], densify_pts=21))
                bbox = [float(x) for x in bbox]
    except Exception:
        bbox = None

    if bbox is None:
        bbox = _bbox_from_lonlat(ds)
    if bbox is None:
        return None

    time = _guess_time_coord(ds)
    start_dt = end_dt = None
    if time is not None:
        try:
            start_dt = time.min().values
            end_dt = time.max().values
            # Convert numpy datetime64 -> python datetime
            start_dt = xr.DataArray(start_dt).astype("datetime64[ns]").values.item()
            end_dt = xr.DataArray(end_dt).astype("datetime64[ns]").values.item()
        except Exception:
            start_dt = end_dt = None

    if start_dt is not None and not isinstance(start_dt, datetime):
        start_dt = None
    if end_dt is not None and not isinstance(end_dt, datetime):
        end_dt = None

    return GeoExtent(bbox_wgs84=bbox, start_datetime=start_dt, end_datetime=end_dt)


def extent_from_netcdf(path: Path) -> GeoExtent | None:
    ds = xr.open_dataset(path, decode_cf=True, mask_and_scale=False, chunks={}, engine="netcdf4")
    try:
        return extent_from_xarray_dataset(ds)
    finally:
        ds.close()


def extent_from_zarr(path: Path) -> GeoExtent | None:
    ds = xr.open_zarr(path, consolidated=None)
    try:
        return extent_from_xarray_dataset(ds)
    finally:
        ds.close()


def extent_from_asset(path: Path) -> GeoExtent | None:
    lower = path.name.lower()
    if path.is_dir() and lower.endswith(".zarr"):
        return extent_from_zarr(path)
    ext = path.suffix.lower()
    if ext in {".tif", ".tiff", ".geotiff", ".gtiff"}:
        return extent_from_geotiff(path)
    if ext in {".nc", ".netcdf"}:
        return extent_from_netcdf(path)
    return None


def union_extents(extents: Iterable[GeoExtent]) -> GeoExtent | None:
    exts = [e for e in extents if e is not None]
    if not exts:
        return None
    minx = min(e.bbox_wgs84[0] for e in exts)
    miny = min(e.bbox_wgs84[1] for e in exts)
    maxx = max(e.bbox_wgs84[2] for e in exts)
    maxy = max(e.bbox_wgs84[3] for e in exts)

    starts = [e.start_datetime for e in exts if e.start_datetime is not None]
    ends = [e.end_datetime for e in exts if e.end_datetime is not None]
    start_dt = min(starts) if starts else None
    end_dt = max(ends) if ends else None
    return GeoExtent(bbox_wgs84=[minx, miny, maxx, maxy], start_datetime=start_dt, end_datetime=end_dt)

