#!/usr/bin/env bash
# Shared helpers for end-to-end deployment tests.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE=(docker compose)
E2E_PROJECT="${E2E_PROJECT:-stac-e2e}"

log() { printf '[e2e] %s\n' "$*"; }
fail() { printf '[e2e] ERROR: %s\n' "$*" >&2; exit 1; }

compose() {
  "${COMPOSE[@]}" -p "$E2E_PROJECT" "$@"
}

wait_http() {
  local url="$1"
  local timeout="${2:-120}"
  local i=0
  log "Attente de ${url} (max ${timeout}s)…"
  until curl -fsS "$url" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "$i" -ge "$timeout" ]]; then
      compose ps >&2 || true
      fail "Timeout: ${url}"
    fi
    sleep 1
  done
}

stack_up() {
  local port="$1"
  log "Démarrage stack HTTP_PORT=${port} (projet ${E2E_PROJECT}, à la racine /)"
  HTTP_PORT="$port" compose up -d --build --force-recreate
}

stack_down() {
  log "Arrêt stack (projet ${E2E_PROJECT})"
  compose down -v --remove-orphans 2>/dev/null || compose down --remove-orphans 2>/dev/null || true
}

assert_api_links() {
  local api_url="$1"
  local expected_data_href="$2"
  local fetch_origin="${3:-$(echo "$api_url" | sed -E 's#(https?://[^/]+).*#\1#')}"

  log "Vérification API ${api_url}"
  local body
  body="$(curl -fsS "${api_url}")"

  printf '%s' "$body" | python3 "$ROOT_DIR/scripts/e2e/assert_api.py" \
    --expected-data "$expected_data_href" \
    --fetch-origin "$fetch_origin"
}

assert_browser() {
  local browser_url="$1"
  local api_path="$2"

  log "Vérification browser ${browser_url}"
  local html config
  html="$(curl -fsS "${browser_url}")"
  [[ "$html" == *"STAC"* ]] || fail "Page browser inattendue: ${browser_url}"

  config="$(curl -fsS "${browser_url%/}/config.js")"
  [[ "$config" == *"catalogUrl"* ]] || fail "config.js invalide"
  [[ "$config" == *"${api_path}"* ]] || fail "catalogUrl ne contient pas ${api_path}: ${config}"
  log "OK: browser ${browser_url}"
}

assert_viewer_proxy() {
  local base_url="$1"
  local viewer_url="${base_url%/}/viewer/"
  local proxy_url="${viewer_url}proxy/https/httpbin.org/get"

  log "Vérification viewer ${viewer_url}"
  local html
  html="$(curl -fsS "${viewer_url}")"
  [[ "$html" == *"Zarr Image Viewer"* || "$html" == *'id="app"'* ]] \
    || fail "Page viewer inattendue: ${viewer_url}"

  log "Vérification proxy Zarr OPTIONS ${proxy_url}"
  local status
  status="$(curl -fsS -o /dev/null -w '%{http_code}' -X OPTIONS "${proxy_url}")"
  [[ "$status" == "204" ]] || fail "Proxy OPTIONS attendu 204, reçu ${status}: ${proxy_url}"

  log "Vérification proxy Zarr HEAD ${proxy_url}"
  status="$(curl -sS -o /dev/null -w '%{http_code}' -I "${proxy_url}")"
  [[ "$status" != "404" ]] || fail "Proxy HEAD ne doit pas retourner 404: ${proxy_url}"
  log "OK: viewer + proxy ${viewer_url}"
}
