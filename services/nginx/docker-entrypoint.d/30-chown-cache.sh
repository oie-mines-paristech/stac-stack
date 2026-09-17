#!/bin/sh
# nginx workers run as NGINX_UID/GID: client_body_temp must be writable by them
# (PUT/MKCOL go through it), so hand /var/cache/nginx over before start.
set -e
chown -R "${NGINX_UID:-1000}:${NGINX_GID:-1000}" /var/cache/nginx