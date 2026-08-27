#!/bin/sh
set -eu

VUE_PORT="${VUE_DEV_SERVER_PORT:-8081}"

is_dev() {
  case "${DEV:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_dev; then
  echo "dev-entrypoint.sh requires DEV=1" >&2
  exit 1
fi

# Install deps from mounted package-lock.json (image node_modules used when lock unchanged).
echo "[stac-browser dev] npm install..."
npm install

mkdir -p /usr/share/nginx/html/viewer

CONFIG_OUTPUT=/tmp/stac-browser-config.js \
  /app/docker/docker-entrypoint.sh

export STAC_BROWSER_CONFIG_JS=/tmp/stac-browser-config.js

if [ -f /docker-entrypoint.d/05-path-prefix.sh ]; then
  STAC_BROWSER_DEV=1 sh /docker-entrypoint.d/05-path-prefix.sh
fi

if [ -f /docker-entrypoint.d/45-catalog-url.sh ]; then
  sh /docker-entrypoint.d/45-catalog-url.sh
fi

export NODE_ENV=development
# Avoid eslint re-triggering webpack on bind-mounted files in Docker.
export VUE_CLI_LINT=false

npm run start -- --host 0.0.0.0 --port "$VUE_PORT" &
VUE_PID=$!

cleanup() {
  kill "$VUE_PID" 2>/dev/null || true
  nginx -s quit 2>/dev/null || true
}
trap cleanup INT TERM

i=0
PREFIX="${PATH_PREFIX:-/}"
case "$PREFIX" in
  /) CHECK_URL="http://127.0.0.1:${VUE_PORT}/" ;;
  */) CHECK_URL="http://127.0.0.1:${VUE_PORT}${PREFIX}" ;;
  *) CHECK_URL="http://127.0.0.1:${VUE_PORT}${PREFIX}/" ;;
esac
while ! wget -q -O /dev/null "$CHECK_URL" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "Vue dev server did not start within 60s" >&2
    exit 1
  fi
  sleep 1
done

echo "[stac-browser dev] Vue dev server ready on port ${VUE_PORT}"

nginx -g 'daemon off;' &
NGINX_PID=$!

wait "$NGINX_PID"
cleanup
