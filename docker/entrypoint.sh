#!/usr/bin/env bash
set -euo pipefail

INPUT_DIR="${INPUT_DIR:-/data/in}"
OUTPUT_DIR="${OUTPUT_DIR:-/data/catalog}"
ROOT_HREF="${ROOT_HREF:-/root}"
WATCH_DEBOUNCE="${WATCH_DEBOUNCE:-10}"

mkdir -p "$OUTPUT_DIR"

child_pid=""
term_requested="0"

on_term() {
  term_requested="1"
  if [[ -n "${child_pid}" ]]; then
    kill -TERM "${child_pid}" 2>/dev/null || true
  fi
}
trap on_term INT TERM

echo "[docker] INPUT_DIR=${INPUT_DIR}"
echo "[docker] OUTPUT_DIR=${OUTPUT_DIR}"
echo "[docker] ROOT_HREF=${ROOT_HREF}"
echo "[docker] WATCH_DEBOUNCE=${WATCH_DEBOUNCE}"

while true; do
  echo "[docker] starting generate-stac --watch (will restart on crash)"

  # Run in background so we can trap/forward signals.
  uv run generate-stac \
    --input "${INPUT_DIR}" \
    --output "${OUTPUT_DIR}" \
    --root-href "${ROOT_HREF}" \
    --watch \
    --watch-debounce "${WATCH_DEBOUNCE}" &
  child_pid="$!"

  set +e
  wait "${child_pid}"
  code="$?"
  set -e
  child_pid=""

  if [[ "${term_requested}" == "1" ]]; then
    echo "[docker] termination requested, exiting"
    exit 0
  fi

  echo "[docker] generate-stac exited (code=${code}), restarting in 2s..."
  sleep 2
done

