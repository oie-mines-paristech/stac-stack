#!/usr/bin/env bash
# E2E WebDAV /data: read public, write admin-only; /dav: fully authenticated
# admin root with data (rw) + catalog (ro). Files owned by NGINX_UID:GID.
set -euo pipefail

source "$(dirname "$0")/common.sh"

HTTP_PORT="${TEST_DIRECT_PORT:-18002}"
WEBDAV_ADMIN="${WEBDAV_ADMIN:-e2eadmin}"
WEBDAV_PASSWORD="🔒env_secret_1🔓"

E2E_PROJECT="stac-e2e-webdav"
DATA_DIR="tests/e2e-data"
DATA_URL="http://localhost:${HTTP_PORT}/data"
UPLOAD="$ROOT_DIR/tests/e2e-upload.txt"
BIG="$ROOT_DIR/tests/e2e-big.bin"

trap 'stack_down; rm -rf "$DATA_DIR" "$UPLOAD" "$BIG"; trap - EXIT' EXIT

export HTTP_PORT WEBDAV_ADMIN WEBDAV_PASSWORD

log "=== E2E: WebDAV /data (http://localhost:${HTTP_PORT}/data/) ==="
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"          # bind source must exist and be owned by the host user

compose -f docker-compose.yml -f tests/docker-compose.webdav.yml up -d --build
wait_http "http://localhost:${HTTP_PORT}/data/"

status() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

echo "hello webdav" > "$UPLOAD"

# --- OPTIONS: DAV: 2 header (dav-ext handles it, not if-return-204) ---
OPTIONS_HDR=$(curl -sS -D- -o /dev/null -X OPTIONS "$DATA_URL/")
[[ "$OPTIONS_HDR" == *"DAV: 2"* ]]
log "OK: OPTIONS DAV: 2"

# --- WRITE admin: PUT / MKCOL / nested PUT (create_full_put_path) / 2 Mo ---
[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -T "$UPLOAD" "$DATA_URL/e2e-upload.txt")" == "201" ]]
log "OK: PUT admin 201"

[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -X MKCOL "$DATA_URL/e2e-dir/")" == "201" ]]
log "OK: MKCOL admin (trailing slash auto) 201"

[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -T "$UPLOAD" "$DATA_URL/e2e-dir/nested-upload.txt")" == "201" ]]
log "OK: PUT nested (create_full_put_path) 201"

dd if=/dev/zero of="$BIG" bs=1M count=2 2>/dev/null
[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -T "$BIG" "$DATA_URL/e2e-big.bin")" == "201" ]]
log "OK: PUT 2 Mo (client_max_body_size 0) 201"

# --- Cache-Control: only Zarr-chunk-shaped paths (no dot in the last segment)
# are cacheable; metadata documents and ordinary files revalidate every time,
# otherwise a browser keeps a stale zarr.json after a store is consolidated.
[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -T "$UPLOAD" "$DATA_URL/e2e-chunk")" == "201" ]]
cache_control() { curl -sS -o /dev/null -D- "$1" | grep -i '^cache-control:' | tr -d '\r'; }
[[ "$(cache_control "$DATA_URL/e2e-chunk")" == *"max-age=3600"* ]] \
  || fail "Cache-Control chunk attendu max-age=3600: $(cache_control "$DATA_URL/e2e-chunk")"
[[ "$(cache_control "$DATA_URL/e2e-upload.txt")" == *"max-age=0"* ]] \
  || fail "Cache-Control fichier attendu max-age=0: $(cache_control "$DATA_URL/e2e-upload.txt")"
log "OK: Cache-Control chunk 1h / metadata revalidate"

# --- READ public ---
[[ "$(curl -fsS "$DATA_URL/e2e-upload.txt")" == "hello webdav" ]]
log "OK: GET public"

[[ "$(status -X PROPFIND -H "Depth: 1" "$DATA_URL/")" == "207" ]]
log "OK: PROPFIND anon 207"

[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -X PROPFIND -H "Depth: 1" "$DATA_URL/")" == "207" ]]
log "OK: PROPFIND admin 207"

# --- WRITE anon denied ---
[[ "$(status -T "$UPLOAD" "$DATA_URL/e2e-anon.txt")" == "401" ]]
log "OK: PUT anonyme 401"

[[ "$(status -X MKCOL "$DATA_URL/e2e-anon-dir/")" == "401" ]]
log "OK: MKCOL anonyme 401"

[[ "$(status -X DELETE "$DATA_URL/e2e-upload.txt")" == "401" ]]
log "OK: DELETE anonyme 401"

# --- DELETE admin + verify disappearance ---
[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -X DELETE "$DATA_URL/e2e-upload.txt")" == "204" ]]
[[ ! -f "$DATA_DIR/e2e-upload.txt" ]]
log "OK: DELETE admin 204"

[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -X DELETE "$DATA_URL/e2e-chunk")" == "204" ]]

# --- Ownership: host NGINX_UID:GID ---
owner="$(stat -c '%u:%g' "$DATA_DIR/e2e-big.bin")"
[[ "$owner" == "${NGINX_UID:-1000}:${NGINX_GID:-1000}" ]] || fail "Ownership attendu 1000:1000, obtenu ${owner}"
log "OK: ownership host ${owner}"

log "PASS: WebDAV /data"

# --- WebDAV admin root /dav: exposes data (rw) + catalog (ro) ---
log "=== E2E: WebDAV /dav (root admin) ==="
[[ "$(curl -sS -D- -o /dev/null -X OPTIONS http://localhost:${HTTP_PORT}/dav)" == *"DAV: 2"* ]]
log "OK: /dav OPTIONS DAV: 2"

[[ "$(status http://localhost:${HTTP_PORT}/dav/)" == "401" ]]
log "OK: /dav GET anon 401"

DAVROOT=$(curl -sS -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -X PROPFIND -H "Depth: 1" "http://localhost:${HTTP_PORT}/dav/")
[[ "$DAVROOT" == *"/dav/data/"* && "$DAVROOT" == *"/dav/catalog/"* ]]
log "OK: /dav lists data/ + catalog/"

[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -T "$UPLOAD" "http://localhost:${HTTP_PORT}/dav/data/e2e-dav-upload.txt")" == "201" ]]
log "OK: /dav/data write 201"
[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -X DELETE "http://localhost:${HTTP_PORT}/dav/data/e2e-dav-upload.txt")" == "204" ]]
log "OK: /dav/data delete 204"

# catalog mounted :ro → nginx write returns an error (500 on the RO filesystem)
[[ "$(status -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" -T "$UPLOAD" "http://localhost:${HTTP_PORT}/dav/catalog/e2e-ro.txt")" != "201" ]]
log "OK: /dav/catalog read-only (write rejected)"
[[ "$(curl -fsS -u "$WEBDAV_ADMIN:$WEBDAV_PASSWORD" "http://localhost:${HTTP_PORT}/dav/catalog/status.log")" == "ERROR"* ]]
log "OK: /dav/catalog/status.log readable (debug)"