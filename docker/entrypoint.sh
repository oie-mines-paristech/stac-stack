#!/usr/bin/env bash
set -euo pipefail

INPUT_DIR="${INPUT_DIR:-/data/in}"
OUTPUT_DIR="${OUTPUT_DIR:-/data/catalog}"
WATCH_DEBOUNCE="${WATCH_DEBOUNCE:-10}"

normalize_path_prefix() {
  local p="${1:-/}"
  case "$p" in
    /*) ;;
    *) p="/$p" ;;
  esac
  if [[ "$p" == "/" ]]; then
    printf '%s' "/"
    return
  fi
  case "$p" in
    */) printf '%s' "$p" ;;
    *) printf '%s' "${p}/" ;;
  esac
}

PATH_PREFIX="$(normalize_path_prefix "${PATH_PREFIX:-/}")"
if [[ -z "${ROOT_HREF:-}" ]]; then
  ROOT_HREF="${PATH_PREFIX}data"
fi

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
echo "[docker] PATH_PREFIX=${PATH_PREFIX}"
echo "[docker] ROOT_HREF=${ROOT_HREF}"
echo "[docker] WATCH_DEBOUNCE=${WATCH_DEBOUNCE}"

echo "[docker] bootstrap generation (required on every startup)..."
if ! uv run generate-stac \
  --input "${INPUT_DIR}" \
  --output "${OUTPUT_DIR}" \
  --root-href "${ROOT_HREF}"; then
  echo "[docker] bootstrap generation failed — fix input/catalog errors before starting the stack" >&2
  exit 1
fi

while true; do
  echo "[docker] starting generate-stac --watch (incremental updates)"

  # Run in background so we can trap/forward signals.
  uv run generate-stac \
    --input "${INPUT_DIR}" \
    --output "${OUTPUT_DIR}" \
    --root-href "${ROOT_HREF}" \
    --watch \
    --watch-debounce "${WATCH_DEBOUNCE}" \
    --skip-initial &
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
