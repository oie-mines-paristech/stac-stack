#!/usr/bin/env bash
# Test déploiement HTTP direct (sans reverse proxy externe).
set -euo pipefail

source "$(dirname "$0")/common.sh"

HTTP_PORT="${TEST_DIRECT_PORT:-18001}"

E2E_PROJECT="stac-e2e-direct"
trap 'stack_down' EXIT

log "=== E2E: HTTP direct (http://localhost:${HTTP_PORT}/) ==="

stack_up "$HTTP_PORT"
wait_http "http://localhost:${HTTP_PORT}/api/"
assert_api_links "http://localhost:${HTTP_PORT}/api/" "/api/collections"
assert_browser "http://localhost:${HTTP_PORT}/" "/api/"
assert_viewer_proxy_disabled "http://localhost:${HTTP_PORT}"
log "PASS: HTTP direct root"

trap - EXIT
stack_down
log "=== Test HTTP direct OK ==="