# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# nginx + WebDAV (PROPFIND/PROPPATCH/LOCK/UNLOCK via arut/nginx-dav-ext-module)
# + mod_zip (evanmiller/mod_zip, ZIP streaming).
#
# OFFICIAL base image: the standard ngx_http_dav_module (PUT/DELETE/MKCOL/COPY/
# MOVE) is already compiled in, and both third-party modules are added as
# dynamic .so — no fork, no third-party base to trust. Re-pin with
# scripts/repin-digests.sh: the module stage reads `nginx -v` from the same
# image, so a base bump rebuilds both modules against the new ABI by itself.
#
# The previous base, hakwerk/nginx-dav, was abandoned upstream (its :latest
# digest had not moved, so it kept shipping a vulnerable Debian base). Building
# the modules here was the only way to pick up OS patches.
#
# HTTPS/TLS is NOT terminated here; the deploy relies on an external reverse
# proxy in front of ${HTTP_PORT}.
ARG NGINX_DIGEST=@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

# Module stage: compile both modules against the exact nginx version of the
# runtime stage (read from `nginx -v`, so a base bump cannot desync the ABI).
# `--with-compat` on both sides is what makes the dynamic load work; building a
# module against a different nginx build fails with "not binary compatible".
FROM nginx:alpine${NGINX_DIGEST} AS modules
# dav-ext links libxml2/libxslt through nginx's own build machinery (see its
# `config` file), so the -dev headers are what it needs.
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    apk add --no-cache build-base curl libxml2-dev libxslt-dev pcre2-dev zlib-dev

RUN set -eux; \
    NGINX_VERSION="$(nginx -v 2>&1 | sed -E 's#.*nginx/([0-9.]+).*#\1#')"; \
    DAV_EXT_VERSION=3.0.0; \
    MOD_ZIP_VERSION=1.3.0; \
    HEADERS_MORE_VERSION=0.40; \
    echo "building dav-ext ${DAV_EXT_VERSION} + mod_zip ${MOD_ZIP_VERSION} + headers-more ${HEADERS_MORE_VERSION} for nginx ${NGINX_VERSION}"; \
    mkdir -p /build; cd /build; \
    curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" | tar -xz; \
    curl -fsSL "https://github.com/arut/nginx-dav-ext-module/archive/refs/tags/v${DAV_EXT_VERSION}.tar.gz" | tar -xz; \
    curl -fsSL "https://github.com/evanmiller/mod_zip/archive/refs/tags/${MOD_ZIP_VERSION}.tar.gz" | tar -xz; \
    curl -fsSL "https://github.com/openresty/headers-more-nginx-module/archive/refs/tags/v${HEADERS_MORE_VERSION}.tar.gz" | tar -xz; \
    cd "nginx-${NGINX_VERSION}"; \
    ./configure --with-compat --with-http_dav_module \
        --add-dynamic-module="/build/nginx-dav-ext-module-${DAV_EXT_VERSION}" \
        --add-dynamic-module="/build/mod_zip-${MOD_ZIP_VERSION}" \
        --add-dynamic-module="/build/headers-more-nginx-module-${HEADERS_MORE_VERSION}"; \
    make -j"$(nproc)" modules; \
    cp objs/ngx_http_dav_ext_module.so objs/ngx_http_zip_module.so objs/ngx_http_headers_more_filter_module.so /usr/lib/nginx/modules/

FROM nginx:alpine${NGINX_DIGEST}

# openssl CLI for 20-htpasswd.sh (`openssl passwd -apr1`); the official image
# ships libssl but not the binary.
RUN apk add --no-cache openssl

# headers-more gives `more_set_input_headers "Destination: …"`, which dav-ext
# needs on MOVE/COPY; nginx core cannot add a request header conditionally.
COPY --from=modules /usr/lib/nginx/modules/ngx_http_dav_ext_module.so /usr/lib/nginx/modules/ngx_http_zip_module.so /usr/lib/nginx/modules/ngx_http_headers_more_filter_module.so /usr/lib/nginx/modules/

# Adds 10-user.sh (webdav user/group from NGINX_UID/GID), 20-htpasswd.sh
# (Basic-auth file from WEBDAV_ADMIN/PASSWORD via openssl — no apache2-utils in
# this image) and 30-chown-cache.sh (client_body_temp writable by the worker),
# alongside the base image's own entrypoint scripts. Never mount a dir over
# /docker-entrypoint.d — that would hide the image's scripts.
COPY docker-entrypoint.d/ /docker-entrypoint.d/