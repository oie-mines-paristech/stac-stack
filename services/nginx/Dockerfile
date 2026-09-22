# nginx with WebDAV (PROPFIND/LOCK/UNLOCK via arut/nginx-dav-ext-module) and
# mod_zip (evanmiller/mod_zip, ZIP streaming), based on the THIRD-PARTY image
# hakwerk/nginx-dav (official nginx + static dav-ext).
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
FROM hakwerk/nginx-dav:latest@sha256:af0c4200dcc7e9e5e5dec438e2f90cb14b7c412155c3975d228a0d49fe05c732 AS modzip

# Compile mod_zip as a DYNAMIC module against the exact nginx version shipped by
# the base image (read from `nginx -v`, so a base bump cannot desync the ABI).
# `--with-compat` on both sides is what makes the dynamic load work; building a
# module against a different nginx build fails with "not binary compatible".
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl libpcre2-dev zlib1g-dev libssl-dev; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    NGINX_VERSION="$(nginx -v 2>&1 | sed -E 's#.*nginx/([0-9.]+).*#\1#')"; \
    MOD_ZIP_VERSION=1.3.0; \
    echo "building mod_zip ${MOD_ZIP_VERSION} for nginx ${NGINX_VERSION}"; \
    mkdir -p /build; cd /build; \
    curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" | tar -xz; \
    curl -fsSL "https://github.com/evanmiller/mod_zip/archive/refs/tags/${MOD_ZIP_VERSION}.tar.gz" | tar -xz; \
    cd "nginx-${NGINX_VERSION}"; \
    ./configure --with-compat --add-dynamic-module="/build/mod_zip-${MOD_ZIP_VERSION}"; \
    make -j"$(nproc)" modules; \
    cp objs/ngx_http_zip_module.so /usr/lib/nginx/modules/ngx_http_zip_module.so

FROM hakwerk/nginx-dav:latest@sha256:af0c4200dcc7e9e5e5dec438e2f90cb14b7c412155c3975d228a0d49fe05c732

COPY --from=modzip /usr/lib/nginx/modules/ngx_http_zip_module.so /usr/lib/nginx/modules/ngx_http_zip_module.so

# Adds 10-user.sh (webdav user/group from NGINX_UID/GID), 20-htpasswd.sh
# (Basic-auth file from WEBDAV_ADMIN/PASSWORD via openssl — no apache2-utils in
# this image) and 30-chown-cache.sh (client_body_temp writable by the worker),
# alongside the image's own entrypoint scripts. Never mount a dir over
# /docker-entrypoint.d — that would hide the image's scripts.
COPY docker-entrypoint.d/ /docker-entrypoint.d/