#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import tempfile
from pathlib import Path
from typing import Any

import netCDF4


def _is_coordinate_variable(ds: netCDF4.Dataset, name: str) -> bool:
    v = ds.variables[name]
    return name in ds.dimensions and tuple(v.dimensions) == (name,)


def _copy_attrs(src: Any, dst: Any) -> None:
    for a in src.ncattrs():
        if a == "_FillValue":
            # Must be set at variable creation time (fill_value=...)
            continue
        # netCDF4 handles most attribute types directly
        dst.setncattr(a, getattr(src, a))


def _create_variable_like(dst: netCDF4.Dataset, src_var: netCDF4.Variable) -> netCDF4.Variable:
    kwargs: dict[str, Any] = {}
    if "_FillValue" in src_var.ncattrs():
        kwargs["fill_value"] = getattr(src_var, "_FillValue")
    # Keep same dtype/dimensions; enable compression (deflate) for size.
    # Compression settings are not "metadata" in the NetCDF sense and shouldn't affect CF/STAC.
    return dst.createVariable(
        src_var.name,
        src_var.dtype,
        src_var.dimensions,
        zlib=True,
        complevel=9,
        shuffle=True,
        **kwargs,
    )


def rewrite_file_in_place(path: Path) -> list[str]:
    """
    Recrée un fichier NetCDF4 neuf avec les mêmes dimensions/variables/attributs,
    en mettant à zéro les variables "data" (non-coord), et en recopiant les coordonnées.
    Remplace ensuite atomiquement le fichier original.
    """
    changed: list[str] = []

    src = netCDF4.Dataset(path, mode="r")
    try:
        tmp_dir = Path(tempfile.mkdtemp(prefix=".nc-rewrite-", dir=str(path.parent)))
        tmp_path = tmp_dir / (path.name + ".tmp")

        dst = netCDF4.Dataset(tmp_path, mode="w", format="NETCDF4")
        try:
            # Dimensions
            for dim_name, dim in src.dimensions.items():
                dst.createDimension(dim_name, (len(dim) if not dim.isunlimited() else None))

            # Global attrs
            _copy_attrs(src, dst)

            # Variables
            for var_name, src_var in src.variables.items():
                dst_var = _create_variable_like(dst, src_var)
                _copy_attrs(src_var, dst_var)

                # Variables à préserver (coords / info station / CRS) : on recopie les données telles quelles.
                if _is_coordinate_variable(src, var_name) or var_name in {
                    "spatial_ref",
                    "crs",
                    "latitude",
                    "longitude",
                    "elevation",
                    "station_name",
                }:
                    # Copy coordinate / reference variables data
                    if len(src_var.dimensions) == 0:
                        if src_var.dtype == str:
                            # netCDF4 scalar string: assignValue() fails for VLEN strings
                            dst_var[...] = src_var[...]
                        else:
                            dst_var.assignValue(src_var.getValue())
                    else:
                        dst_var[:] = src_var[:]
                else:
                    # Zero-out data variables
                    if src_var.dtype == str:
                        # netCDF4 string variables
                        if len(src_var.dimensions) == 0:
                            dst_var[...] = ""
                        else:
                            dst_var[:] = ""
                    elif len(src_var.dimensions) == 0:
                        dst_var.assignValue(0)
                    else:
                        dst_var[:] = 0
                    changed.append(var_name)
        finally:
            dst.close()

        # Atomic replace
        os.replace(str(tmp_path), str(path))
        try:
            tmp_dir.rmdir()
        except Exception:
            pass

    finally:
        src.close()

    return changed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Rewrite NetCDF4 files, zeroing data variables and preserving metadata.")
    p.add_argument("files", nargs="+", help="NetCDF files to rewrite in-place")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    for f in args.files:
        path = Path(f).expanduser().resolve()
        if not path.exists():
            raise SystemExit(f"File not found: {path}")
        changed = rewrite_file_in_place(path)
        print(f"[rewrite_zero] {path}: zeroed {len(changed)} variables")


if __name__ == "__main__":
    main()

