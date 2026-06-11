#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import netCDF4


def is_coordinate_variable(ds: netCDF4.Dataset, name: str) -> bool:
    """
    Heuristique CF classique:
    - variable coordonnée si son nom est une dimension et que sa seule dimension est elle-même.
    """
    try:
        v = ds.variables[name]
    except Exception:
        return False
    return name in ds.dimensions and tuple(v.dimensions) == (name,)


def zero_variable_in_place(v: netCDF4.Variable) -> None:
    """
    Met la variable à zéro sans charger tout en mémoire.
    netCDF4 sait broadcast un scalaire sur tout le tableau.
    """
    # Attention: pour les scalaires (dimensions=()), on met juste la valeur 0.
    if len(v.dimensions) == 0:
        v.assignValue(0)
        return

    # Broadcast scalar write (streaming in netCDF4 C library)
    v[:] = 0


def process_file(path: Path) -> list[str]:
    changed: list[str] = []
    with netCDF4.Dataset(path, mode="r+") as ds:
        for name, v in ds.variables.items():
            # Ne pas toucher aux coordonnées / axes
            if is_coordinate_variable(ds, name):
                continue
            # Ne pas toucher aux variables "grid mapping" souvent utilisées par rioxarray/CF
            if getattr(v, "grid_mapping_name", None) is not None:
                continue
            # Ne pas toucher aux variables de référence spatiale fréquemment nommées ainsi
            if name in {"spatial_ref", "crs"}:
                continue

            # Variables de données (y compris bounds, etc.) => zéro
            zero_variable_in_place(v)
            changed.append(name)

    return changed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Zero out data variables in NetCDF in-place, preserving metadata.")
    p.add_argument("files", nargs="+", help="NetCDF files to modify in-place")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    for f in args.files:
        path = Path(f).expanduser().resolve()
        if not path.exists():
            raise SystemExit(f"File not found: {path}")
        changed = process_file(path)
        print(f"[zero_netcdf] {path}: zeroed {len(changed)} variables")


if __name__ == "__main__":
    main()

