#!/usr/bin/env bash
# Test déploiement derrière reverse proxy nginx HTTPS (certificat auto-signé).
set -euo pipefail

source "$(dirname "$0")/common.sh"

BACKEND_PORT="${TEST_BACKEND_PORT:-18002}"
HTTPS_PORT="${TEST_HTTPS_PORT:-18443}"
PATH_PREFIX="/stac/"
E2E_PROJECT="stac-e2e-proxy"

cleanup() {
  proxy_down
  rm -f "$ROOT_DIR/tests/nginx/https-stac.generated.conf"
}
trap cleanup EXIT

ensure_certs

log "=== E2E: reverse proxy HTTPS (localhost:${HTTPS_PORT}/stac/) ==="

stack_up_with_proxy "$BACKEND_PORT" "$HTTPS_PORT"

wait_https "https://localhost:${HTTPS_PORT}/stac/api/"

expected_data="/stac/api/collections"
assert_api_links_https "https://localhost:${HTTPS_PORT}/stac/api/" "$expected_data"
assert_browser "https://localhost:${HTTPS_PORT}/stac/" "/stac/api/"

log "=== Test reverse proxy HTTPS OK ==="
