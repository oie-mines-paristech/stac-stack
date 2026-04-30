#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <file1.nc> [file2.nc ...]" >&2
  exit 2
fi

for f in "$@"; do
  if [[ ! -f "$f" ]]; then
    echo "File not found: $f" >&2
    exit 2
  fi

  tmp="${f}.repack.tmp"
  # -4 : NetCDF4 output
  # -L 9 : deflate level 9 (max compression)
  # -O : overwrite output if exists
  ncks -4 -L 9 -O "$f" "$tmp"
  mv -f "$tmp" "$f"
  echo "[repack] $f"
done

