#!/bin/sh
set -eu

# Normalize PATH_PREFIX: "/", "/stac", "/stac/" -> "/" or "/stac/"
normalize_path_prefix() {
    p="${1:-/}"
    case "$p" in
        /*) ;;
        *) p="/$p" ;;
    esac
    if [ "$p" = "/" ]; then
        printf '%s' "/"
        return
    fi
    case "$p" in
        */) printf '%s' "$p" ;;
        *) printf '%s' "${p}/" ;;
    esac
}

PATH_PREFIX="$(normalize_path_prefix "${PATH_PREFIX:-/}")"
export PATH_PREFIX
export SB_catalogUrl="${PATH_PREFIX}api/"

if [ "$PATH_PREFIX" != "/" ]; then
    bare="${PATH_PREFIX%/}"
    export PATH_PREFIX_REDIRECT_BLOCK="location = ${bare} {
        return 301 ${PATH_PREFIX};
    }"
else
    export PATH_PREFIX_REDIRECT_BLOCK=""
fi

echo "[nginx] PATH_PREFIX=${PATH_PREFIX}"
echo "[nginx] SB_catalogUrl=${SB_catalogUrl}"

printf '%s' "${SB_catalogUrl}" > /tmp/stac-catalog-url

TEMPLATE="/etc/stac/nginx/default.conf.template"
if [ "${STAC_BROWSER_DEV:-0}" = "1" ]; then
    TEMPLATE="/etc/stac/nginx/default.conf.dev.template"
fi

envsubst '${PATH_PREFIX} ${PATH_PREFIX_REDIRECT_BLOCK}' \
    < "$TEMPLATE" \
    > /tmp/stac-nginx.conf
