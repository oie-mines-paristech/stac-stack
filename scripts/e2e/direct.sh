#!/usr/bin/env bash
# Test déploiement HTTP direct (sans reverse proxy externe).
set -euo pipefail

source "$(dirname "$0")/common.sh"

PORT="${TEST_DIRECT_PORT:-18001}"

run_case() {
  local path_prefix="$1"
  local label="$2"
  local api_path browser_path expected_data

  if [[ "$path_prefix" == "/" ]]; then
    api_path="/api/"
    browser_path="/"
    expected_data="/api/collections"
  else
    api_path="/stac/api/"
    browser_path="/stac/"
    expected_data="/stac/api/collections"
  fi

  E2E_PROJECT="stac-e2e-direct-${label}"
  trap 'stack_down' EXIT

  stack_up "$path_prefix" "$PORT"
  wait_http "http://localhost:${PORT}${api_path}"
  assert_api_links "http://localhost:${PORT}${api_path}" "$expected_data"
  assert_browser "http://localhost:${PORT}${browser_path}" "$api_path"
  assert_viewer_proxy "http://localhost:${PORT}" "$path_prefix"

  trap - EXIT
  stack_down
  log "PASS: HTTP direct PATH_PREFIX=${path_prefix}"
}

log "=== E2E: HTTP direct (localhost:${PORT}) ==="
run_case "/" "root"
run_case "/stac/" "stac"
log "=== Tous les tests HTTP direct OK ==="
