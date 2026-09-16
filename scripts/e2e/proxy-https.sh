#!/usr/bin/env bash
# Test HTTPS du stack nginx interne (certificat auto-signé monté).
set -euo pipefail

source "$(dirname "$0")/common.sh"

HTTPS_PORT="${TEST_HTTPS_PORT:-18443}"
HTTP_PORT="${TEST_BACKEND_PORT:-18002}"
E2E_PROJECT="stac-e2e-proxy"

cleanup() {
  compose down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

ensure_certs

log "=== E2E: HTTPS nginx interne (https://localhost:${HTTPS_PORT}/) ==="

log "Démarrage stack HTTPS HTTP_PORT=${HTTP_PORT} (racine /)"
HTTP_PORT="$HTTP_PORT" HTTPS_PORT="$HTTPS_PORT" compose -f docker-compose.yml -f tests/docker-compose.proxy.yml up -d --build --force-recreate

wait_https "https://localhost:${HTTPS_PORT}/api/"

expected_data="/api/collections"
assert_api_links_https "https://localhost:${HTTPS_PORT}/api/" "$expected_data"
assert_browser "https://localhost:${HTTPS_PORT}/" "/api/"

log "=== Test nginx HTTPS OK ==="