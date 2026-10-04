#!/bin/sh
# Generate the htpasswd from .env (Basic auth). Empty file = writes disabled.
# The nginx base has no apache2-utils, so we use `openssl passwd -apr1` (the
# official image ships libssl but not the openssl binary — the Dockerfile
# installs it). Same $apr1$ format nginx auth_basic accepts.
set -e
if [ -n "${WEBDAV_ADMIN:-}" ] && [ -n "${WEBDAV_PASSWORD:-}" ]; then
    hash="$(printf '%s' "${WEBDAV_PASSWORD}" | openssl passwd -apr1 -stdin)"
    printf '%s:%s\n' "$WEBDAV_ADMIN" "$hash" > /etc/nginx/htpasswd
else
    : > /etc/nginx/htpasswd
fi