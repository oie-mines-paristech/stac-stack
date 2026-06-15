#!/bin/sh
set -eu

CONFIG=/usr/share/nginx/html/config.js
CATALOG_URL="$(cat /tmp/stac-catalog-url)"

if [ ! -f "$CONFIG" ]; then
    echo "[nginx] config.js not found, skipping catalogUrl patch"
    exit 0
fi

# Inject absolute catalogUrl (origin + API path) so stac-browser matches API hrefs.
tmp="$(mktemp)"
awk -v path="$CATALOG_URL" '
  /^}$/ && !done {
    print "  catalogUrl: window.location.origin + '\''" path "'\'',"
    done=1
  }
  { print }
' "$CONFIG" > "$tmp"
mv "$tmp" "$CONFIG"

echo "[nginx] patched config.js catalogUrl=window.location.origin + '${CATALOG_URL}'"
