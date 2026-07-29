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

wait_https() {
  local url="$1"
  local timeout="${2:-120}"
  local i=0
  log "Attente de ${url} (max ${timeout}s, certificat auto-signé)…"
  until curl -kfsS "$url" | python3 -c "import json,sys; json.load(sys.stdin)" >/dev/null 2>&1; do
    i=$((i + 1))
    if [[ "$i" -ge "$timeout" ]]; then
      compose -f docker-compose.yml -f tests/docker-compose.proxy.yml -p "$E2E_PROJECT" ps >&2 || true
      fail "Timeout: ${url}"
    fi
    sleep 1
  done
}

generate_https_proxy_conf() {
  local https_port="$1"
  sed "s/__HTTPS_PORT__/${https_port}/g" \
    "$ROOT_DIR/tests/nginx/https-stac.conf.template" \
    > "$ROOT_DIR/tests/nginx/https-stac.generated.conf"
}

stack_up() {
  local path_prefix="$1"
  local port="$2"
  log "Démarrage stack PATH_PREFIX=${path_prefix} PORT=${port} (projet ${E2E_PROJECT})"
  PATH_PREFIX="$path_prefix" PORT="$port" compose up -d --build --force-recreate
}

stack_down() {
  log "Arrêt stack (projet ${E2E_PROJECT})"
  compose down -v --remove-orphans 2>/dev/null || compose down --remove-orphans 2>/dev/null || true
}

stack_up_with_proxy() {
  local port="$1"
  local https_port="$2"
  log "Démarrage stack + reverse proxy HTTPS (backend :${port}, TLS :${https_port})"
  generate_https_proxy_conf "$https_port"
  PATH_PREFIX="/stac/" PORT="$port" TEST_HTTPS_PORT="$https_port" \
    compose -f docker-compose.yml -f tests/docker-compose.proxy.yml \
    up -d --build --force-recreate
}

proxy_down() {
  compose -f docker-compose.yml -f tests/docker-compose.proxy.yml -p "$E2E_PROJECT" down -v --remove-orphans 2>/dev/null || true
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

assert_api_links_https() {
  local api_url="$1"
  local expected_data_href="$2"
  local fetch_origin="${3:-$(echo "$api_url" | sed -E 's#(https?://[^/]+).*#\1#')}"

  log "Vérification API HTTPS ${api_url}"
  local body
  body="$(curl -kfsS "${api_url}")"

  printf '%s' "$body" | python3 "$ROOT_DIR/scripts/e2e/assert_api.py" \
    --expected-data "$expected_data_href" \
    --fetch-origin "$fetch_origin" \
    --https
}

assert_browser() {
  local browser_url="$1"
  local api_path="$2"
  local curl_args=()

  log "Vérification browser ${browser_url}"
  if [[ "$browser_url" == https://* ]]; then
    curl_args=(-k)
  fi

  local html config
  html="$(curl "${curl_args[@]}" -fsS "${browser_url}")"
  [[ "$html" == *"STAC"* ]] || fail "Page browser inattendue: ${browser_url}"

  config="$(curl "${curl_args[@]}" -fsS "${browser_url%/}/config.js")"
  [[ "$config" == *"catalogUrl"* ]] || fail "config.js invalide"
  [[ "$config" == *"${api_path}"* ]] || fail "catalogUrl ne contient pas ${api_path}: ${config}"
  log "OK: browser ${browser_url}"
}

assert_viewer_proxy() {
  local base_url="$1"
  local path_prefix="$2"
  local viewer_url="${base_url%/}${path_prefix}viewer/"
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
  log "OK: viewer + proxy ${path_prefix}viewer/"
}

ensure_certs() {
  local cert_dir="$ROOT_DIR/tests/certs"
  mkdir -p "$cert_dir"
  if [[ ! -f "$cert_dir/cert.pem" || ! -f "$cert_dir/key.pem" ]]; then
    log "Génération certificat TLS auto-signé (tests/certs/)"
    openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
      -keyout "$cert_dir/key.pem" \
      -out "$cert_dir/cert.pem" \
      -subj "/CN=localhost" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null \
      || openssl req -x509 -nodes -days 7 -newkey rsa:2048 \
        -keyout "$cert_dir/key.pem" \
        -out "$cert_dir/cert.pem" \
        -subj "/CN=localhost"
  fi
}
