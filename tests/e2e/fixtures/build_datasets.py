"""Generate minimal NetCDF, Zarr, and GeoTIFF datasets for e2e tests."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
import xarray as xr


def _cube_dataset() -> xr.Dataset:
    times = xr.date_range("2020-01-01", periods=3, freq="D", use_cftime=True, calendar="gregorian")
    lons = np.array([2.0, 2.1])
    lats = np.array([48.0, 48.1])
    data = np.arange(12, dtype="float32").reshape(3, 2, 2)
    return xr.Dataset(
        {
            "temperature": (
                ["time", "lat", "lon"],
                data,
                {
                    "long_name": "Air temperature",
                    "units": "K",
                    "_FillValue": -999.0,
                    "valid_min": 200.0,
                    "valid_max": 350.0,
                    "actual_range": np.array([250.0, 310.0], dtype="float32"),
                },
            )
        },
        coords={
            "time": times,
            "lon": lons,
            "lat": lats,
        },
        attrs={
            "title": "Cube fixture",
            "summary": "Small spatiotemporal cube for e2e tests",
        },
    )


def write_cube_netcdf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ds = _cube_dataset()
    ds.to_netcdf(path, engine="netcdf4")


def write_cube_zarr(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ds = _cube_dataset()
    ds.to_zarr(path, mode="w")


def write_acdd_netcdf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    values = np.array([1.0, 2.0, 3.0], dtype="float32")
    ds = xr.Dataset(
        {"measurement": (["index"], values, {"long_name": "Measurement"})},
        attrs={
            "title": "ACDD fixture dataset",
            "summary": "Dataset with ACDD global metadata only",
            "keywords": "test, acdd, stac",
            "id": "acdd-fixture-001",
            "license": "CC-BY-4.0",
            "institution": "Test Institution",
            "creator_name": "Test Creator",
            "creator_email": "creator@example.com",
            "creator_url": "https://example.com/creator",
            "publisher_name": "Test Publisher",
            "platform": "test-platform",
            "instrument": "test-sensor",
            "program": "test-program",
            "date_created": "2020-01-01T00:00:00Z",
            "date_modified": "2020-06-01T12:00:00Z",
            "geospatial_lat_min": 47.0,
            "geospatial_lat_max": 48.0,
            "geospatial_lon_min": 1.0,
            "geospatial_lon_max": 2.0,
            "time_coverage_start": "2019-01-01T00:00:00Z",
            "time_coverage_end": "2019-12-31T23:59:59Z",
            "references": "https://example.com/paper",
            "metadata_link": "https://example.com/metadata",
        },
    )
    ds.to_netcdf(path, engine="netcdf4")


def write_point_netcdf(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    times = xr.date_range("2021-06-01", periods=2, freq="D", use_cftime=True, calendar="gregorian")
    ds = xr.Dataset(
        {
            "value": (
                ["time"],
                np.array([10.0, 11.0], dtype="float32"),
                {"long_name": "Observed value", "units": "m"},
            )
        },
        coords={
            "time": times,
            "lat": 45.0,
            "lon": 3.0,
        },
    )
    ds.to_netcdf(path, engine="netcdf4")


def write_scalar_latlon_zarr(path: Path) -> None:
    """Zarr with scalar latitude/longitude data vars (fixed-instrument pattern)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    times = xr.date_range("2021-06-01", periods=2, freq="D", use_cftime=True, calendar="gregorian")
    ds = xr.Dataset(
        {
            "value": (
                ["time"],
                np.array([10.0, 11.0], dtype="float32"),
                {"long_name": "Observed value", "units": "m"},
            ),
            "latitude": (
                [],
                np.float64(45.5),
                {"standard_name": "latitude", "long_name": "instrument latitude", "units": "degrees_north"},
            ),
            "longitude": (
                [],
                np.float64(3.5),
                {"standard_name": "longitude", "long_name": "instrument longitude", "units": "degrees_east"},
            ),
        },
        coords={"time": times},
    )
    ds.to_zarr(path, mode="w")


def write_rgb_geotiff(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    height, width = 4, 4
    transform = from_bounds(1.0, 48.0, 1.1, 48.1, width, height)
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 3,
        "dtype": "uint8",
        "crs": "EPSG:4326",
        "transform": transform,
    }
    rng = np.random.default_rng(0)
    data = rng.integers(0, 255, size=(3, height, width), dtype="uint8")
    with rasterio.open(path, "w", **profile) as dst:
        for band in range(1, 4):
            dst.write(data[band - 1], band)
        dst.set_band_description(1, "Red")
        dst.set_band_description(2, "Green")
        dst.set_band_description(3, "Blue")
        dst.colorinterp = [
            rasterio.enums.ColorInterp.red,
            rasterio.enums.ColorInterp.green,
            rasterio.enums.ColorInterp.blue,
        ]


def write_single_geotiff(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    height, width = 2, 2
    transform = from_bounds(5.0, 43.0, 5.2, 43.2, width, height)
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:4326",
        "transform": transform,
        "nodata": -1.0,
    }
    data = np.array([[1.0, 2.0], [3.0, 4.0]], dtype="float32")
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)
        dst.set_band_description(1, "Surface temperature")
        dst.update_tags(1, STATISTICS_MINIMUM="1", STATISTICS_MAXIMUM="4")


def build_datasets(input_root: Path) -> None:
    write_cube_netcdf(input_root / "netcdf" / "cube.nc")
    write_cube_zarr(input_root / "zarr" / "cube.zarr")
    write_cube_zarr(input_root / "zarr-nosuffix" / "cube_store")
    write_acdd_netcdf(input_root / "acdd" / "acdd.nc")
    write_point_netcdf(input_root / "insitu" / "point.nc")
    write_scalar_latlon_zarr(input_root / "insitu" / "scalar_latlon.zarr")
    write_rgb_geotiff(input_root / "geotiff" / "rgb.tif")
    write_single_geotiff(input_root / "geotiff" / "single.tif")
