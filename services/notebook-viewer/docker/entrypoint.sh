#!/bin/sh
set -eu

OUT_DIR="${OUT_DIR:-/out}"

is_dev() {
  case "${DEV:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if is_dev; then
  if [ ! -d node_modules ]; then
    npm ci
  fi
  exec npx vite build --watch --outDir "$OUT_DIR"
fi

mkdir -p "$OUT_DIR"
cp -a /app/dist/. "$OUT_DIR"/
exit 0