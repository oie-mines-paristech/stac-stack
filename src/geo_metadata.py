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


def _to_python_datetime(value: Any) -> datetime | None:
    """
    Convertit proprement un datetime64 numpy en datetime Python.
    Attention: numpy.datetime64.item() retourne souvent un int (ns depuis epoch).
    """
    try:
        import numpy as np

        if isinstance(value, datetime):
            return value
        if isinstance(value, np.datetime64):
            # astype('O') donne un datetime.datetime (ou datetime.date si précision jour)
            obj = value.astype("datetime64[ms]").astype("O")
            return obj if isinstance(obj, datetime) else None
    except Exception:
        pass
    return None


def _format_iso8601_duration_from_seconds(total_seconds: float) -> str | None:
    """
    Formate une durée ISO 8601 (PnDTnHnMnS) à partir de secondes.
    On reste simple: jours/heures/min/sec (pas de mois/année).
    """
    try:
        import math

        if not math.isfinite(total_seconds) or total_seconds <= 0:
            return None
        # arrondi au microseconde près, mais on n'encode que jusqu'aux secondes
        s = int(round(total_seconds))
        days, rem = divmod(s, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, seconds = divmod(rem, 60)

        out = "P"
        if days:
            out += f"{days}D"
        if hours or minutes or seconds:
            out += "T"
            if hours:
                out += f"{hours}H"
            if minutes:
                out += f"{minutes}M"
            if seconds:
                out += f"{seconds}S"
        # cas exact 0 (devrait être filtré) ou uniquement P
        return out if out != "P" else None
    except Exception:
        return None


def _guess_step_for_coord(c: xr.DataArray, *, dim_type: str) -> Any | None:
    """
    Step homogène estimé avec les 2 premières valeurs de la coordonnée.
    - spatial: nombre (float)
    - temporal: durée ISO 8601 (string)
    """
    try:
        if c.size < 2:
            return None
        a = c.isel({c.dims[0]: 0}).values
        b = c.isel({c.dims[0]: 1}).values

        # Temporal: datetime64 ou décodable
        if dim_type == "temporal":
            try:
                import numpy as np

                if isinstance(a, np.datetime64) and isinstance(b, np.datetime64):
                    dt = b - a
                    # conversion en secondes
                    seconds = float(dt / np.timedelta64(1, "s"))
                    return _format_iso8601_duration_from_seconds(abs(seconds))
            except Exception:
                pass
            return None

        # Spatial / other: numérique
        try:
            da = float(a)
            db = float(b)
            step = abs(db - da)
            return step if step > 0 else None
        except Exception:
            return None
    except Exception:
        return None


def _as_datetime_minmax(values: Any, *, units: str | None = None, calendar: str | None = None) -> tuple[datetime | None, datetime | None]:
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
        if units:
            dmin64 = xr.coding.times.decode_cf_datetime(vmin, units=units, calendar=calendar)
            dmax64 = xr.coding.times.decode_cf_datetime(vmax, units=units, calendar=calendar)
        else:
            dmin64 = xr.DataArray(vmin).astype("datetime64[ns]").values
            dmax64 = xr.DataArray(vmax).astype("datetime64[ns]").values
        dmin = _to_python_datetime(dmin64)
        dmax = _to_python_datetime(dmax64)
        return (dmin, dmax)
    except Exception:
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
        units = time.attrs.get("units")
        calendar = time.attrs.get("calendar")
        start_dt, end_dt = _as_datetime_minmax(time.values, units=str(units) if units else None, calendar=str(calendar) if calendar else None)

    if start_dt is not None and not isinstance(start_dt, datetime):
        start_dt = None
    if end_dt is not None and not isinstance(end_dt, datetime):
        end_dt = None

    return GeoExtent(bbox_wgs84=bbox, start_datetime=start_dt, end_datetime=end_dt)


def extent_from_netcdf(path: Path) -> GeoExtent | None:
    # IMPORTANT: ne pas utiliser chunks={} (ça force dask).
    ds = xr.open_dataset(path, decode_cf=True, mask_and_scale=False, engine="netcdf4")
    try:
        return extent_from_xarray_dataset(ds)
    finally:
        ds.close()


def extent_from_zarr(path: Path) -> GeoExtent | None:
    ds = xr.open_zarr(path, consolidated=None)
    try:
        # open_zarr ne décode pas forcément les variables CF (ex: time numeric + units)
        try:
            ds = xr.decode_cf(ds)
        except Exception:
            pass
        return extent_from_xarray_dataset(ds)
    finally:
        ds.close()


def datacube_metadata_from_xarray(ds: xr.Dataset) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Renvoie (cube:dimensions, cube:variables) au format STAC Datacube.
    On reste volontairement minimal: dimensions + variables avec unités/description quand dispo.
    """
    dims: dict[str, Any] = {}
    for dim_name, dim_len in ds.sizes.items():
        dim_type = "other"
        axis = None
        lname = dim_name.lower()
        if lname in {"time", "t"}:
            dim_type = "temporal"
        elif lname in {"x", "lon", "longitude"}:
            dim_type = "spatial"
            axis = "x"
        elif lname in {"y", "lat", "latitude"}:
            dim_type = "spatial"
            axis = "y"

        entry: dict[str, Any] = {"type": dim_type}
        if axis is not None:
            entry["axis"] = axis

        # Extent (si coord existe)
        if dim_name in ds.coords:
            c = ds.coords[dim_name]
            if dim_type == "temporal":
                units = c.attrs.get("units")
                calendar = c.attrs.get("calendar")
                start_dt, end_dt = _as_datetime_minmax(c.values, units=str(units) if units else None, calendar=str(calendar) if calendar else None)
                if start_dt and end_dt:
                    entry["extent"] = [start_dt.isoformat().replace("+00:00", "Z"), end_dt.isoformat().replace("+00:00", "Z")]
                # step temporel (ISO 8601 duration)
                step = _guess_step_for_coord(c, dim_type=dim_type)
                if step is not None:
                    entry["step"] = step
            else:
                try:
                    vmin = float(c.min().values)
                    vmax = float(c.max().values)
                    if vmin <= vmax:
                        entry["extent"] = [vmin, vmax]
                    else:
                        entry["extent"] = [vmax, vmin]
                except Exception:
                    pass
                # step spatial (number)
                if dim_type == "spatial":
                    step = _guess_step_for_coord(c, dim_type=dim_type)
                    if step is not None:
                        entry["step"] = step
        else:
            entry["extent"] = [0, int(dim_len) - 1] if int(dim_len) > 0 else [0, 0]

        dims[dim_name] = entry

    variables: dict[str, Any] = {}
    for var_name, da in ds.data_vars.items():
        v: dict[str, Any] = {"dimensions": list(da.dims)}
        unit = da.attrs.get("units") or da.attrs.get("unit")
        if unit is not None:
            v["unit"] = str(unit)
        desc = da.attrs.get("long_name") or da.attrs.get("standard_name") or da.attrs.get("description")
        if desc is not None:
            v["description"] = str(desc)
        variables[var_name] = v

    return dims, variables


def datacube_metadata_from_asset(path: Path) -> tuple[dict[str, Any], dict[str, Any]] | None:
    lower = path.name.lower()
    try:
        if path.is_dir() and lower.endswith(".zarr"):
            ds = xr.open_zarr(path, consolidated=None)
            try:
                try:
                    ds = xr.decode_cf(ds)
                except Exception:
                    pass
                return datacube_metadata_from_xarray(ds)
            finally:
                ds.close()
        ext = path.suffix.lower()
        if ext in {".nc", ".netcdf"}:
            # IMPORTANT: ne pas utiliser chunks={} (ça force dask).
            ds = xr.open_dataset(path, decode_cf=True, mask_and_scale=False, engine="netcdf4")
            try:
                return datacube_metadata_from_xarray(ds)
            finally:
                ds.close()
    except Exception:
        return None
    return None


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

