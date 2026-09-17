#!/bin/sh
# Generate the htpasswd from .env (Basic auth). Empty file = writes disabled.
# hakwerk/nginx-dav has openssl but no apache2-utils, so we use openssl -apr1
# (same $apr1$ format nginx auth_basic accepts).
set -e
if [ -n "${WEBDAV_ADMIN:-}" ] && [ -n "${WEBDAV_PASSWORD:-}" ]; then
    hash="$(printf '%s' "${WEBDAV_PASSWORD}" | openssl passwd -apr1 -stdin)"
    printf '%s:%s\n' "$WEBDAV_ADMIN" "$hash" > /etc/nginx/htpasswd
else
    : > /etc/nginx/htpasswd
fi