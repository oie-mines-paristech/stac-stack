#!/bin/sh
set -eu

CONFIG="${STAC_BROWSER_CONFIG_JS:-/usr/share/nginx/html/config.js}"
CATALOG_URL="$(cat /tmp/stac-catalog-url)"

if [ ! -f "$CONFIG" ]; then
    echo "[nginx] config.js not found, skipping catalogUrl patch"
    exit 0
fi

# Inject path-absolute catalogUrl so the browser uses the page origin (http or https).
tmp="$(mktemp)"
awk -v path="$CATALOG_URL" '
  /^}$/ && !done {
    print "  catalogUrl: '\''" path "'\'',"
    done=1
  }
  { print }
' "$CONFIG" > "$tmp"
mv "$tmp" "$CONFIG"

echo "[nginx] patched config.js catalogUrl='${CATALOG_URL}'"
