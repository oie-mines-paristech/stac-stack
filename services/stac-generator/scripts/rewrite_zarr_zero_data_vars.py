#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import tempfile
from pathlib import Path

import xarray as xr


def _rewrite_store_zero_data_vars(store_path: Path) -> list[str]:
    """
    Réécrit un store Zarr en mettant à zéro les data_vars, tout en conservant
    coords + attrs. Écrit dans un store temporaire puis remplace atomiquement.
    """
    ds = xr.open_zarr(store_path, consolidated=False, decode_cf=False)
    try:
        # Capture attrs to restore (xarray operations can drop them)
        ds_attrs = dict(ds.attrs)
        var_attrs = {name: dict(da.attrs) for name, da in ds.variables.items()}

        # Keep encodings where possible (chunks, compressors, dtypes...)
        encoding = {}
        for name, da in ds.variables.items():
            enc = dict(getattr(da, "encoding", {}) or {})
            # xarray sometimes puts non-serializable objects; keep only common keys
            keep = {}
            for k in ("chunks", "compressor", "filters", "dtype"):
                if k in enc and enc[k] is not None:
                    keep[k] = enc[k]
            if keep:
                encoding[name] = keep

        zeros = ds.copy(deep=False)
        changed: list[str] = []
        for name in list(ds.data_vars.keys()):
            zeros[name] = xr.zeros_like(ds[name])
            changed.append(name)

        zeros.attrs = ds_attrs
        for name, da in zeros.variables.items():
            da.attrs = var_attrs.get(name, {})

        tmp_dir = Path(tempfile.mkdtemp(prefix=".zarr-rewrite-", dir=str(store_path.parent)))
        tmp_store = tmp_dir / (store_path.name + ".tmp")

        # Écrit aussi les métadonnées consolidées (.zmetadata) pour des ouvertures plus rapides.
        zeros.to_zarr(tmp_store, mode="w", consolidated=True, encoding=encoding)

        # Atomic-ish replace for directory stores
        backup = None
        if store_path.exists():
            backup = tmp_dir / (store_path.name + ".bak")
            shutil.move(store_path, backup)
        shutil.move(tmp_store, store_path)
        if backup is not None:
            shutil.rmtree(backup, ignore_errors=True)

        # Cleanup tmp_dir (may be non-empty if move failed)
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return changed
    finally:
        ds.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Rewrite Zarr stores, zeroing data_vars and preserving metadata.")
    p.add_argument("stores", nargs="+", help="Zarr store directories (*.zarr) to rewrite in-place")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    for s in args.stores:
        path = Path(s).expanduser().resolve()
        if not path.exists() or not path.is_dir():
            raise SystemExit(f"Store not found: {path}")
        changed = _rewrite_store_zero_data_vars(path)
        print(f"[rewrite_zarr_zero] {path}: zeroed {len(changed)} variables")


if __name__ == "__main__":
    main()

