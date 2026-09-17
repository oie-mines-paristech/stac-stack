# nginx with WebDAV (PROPFIND/LOCK/UNLOCK via arut/nginx-dav-ext-module), based
# on the THIRD-PARTY image hakwerk/nginx-dav (official nginx + static dav-ext).
#
# ⚠ SUPPLY CHAIN — third-party base image, NOT an official Docker/nginx build.
#   - Pinned by SHA256 digest; verify the digest is up to date before bumping:
#     docker pull hakwerk/nginx-dav:latest && docker inspect --format '{{index
#     .RepoDigests 0}}' hakwerk/nginx-dav:latest
#   - Upstream: https://github.com/hakwerk/nginx-dav (image built from trust
#     chain of the maintainer's GitHub Action) — review the repo before trusting.
#   - HTTPS/TLS is NOT terminated here; the deploy relies on an external reverse
#     proxy in front of ${HTTP_PORT}.
#
# Tag is informational; the digest is what pulls a reproducible image.
FROM hakwerk/nginx-dav:latest@sha256:af0c4200dcc7e9e5e5dec438e2f90cb14b7c412155c3975d228a0d49fe05c732
# Adds 10-user.sh (webdav user/group from NGINX_UID/GID), 20-htpasswd.sh
# (Basic-auth file from WEBDAV_ADMIN/PASSWORD via openssl — no apache2-utils in
# this image) and 30-chown-cache.sh (client_body_temp writable by the worker),
# alongside the image's own entrypoint scripts. Never mount a dir over
# /docker-entrypoint.d — that would hide the image's scripts.
COPY docker-entrypoint.d/ /docker-entrypoint.d/