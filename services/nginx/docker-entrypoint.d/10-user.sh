#!/bin/sh
# Map the "webdav" user/group (used by the `user` directive) to the uid/gid from
# .env. nginx's `user` only accepts a name (getpwnam), not a numeric id.
set -e

uid="${NGINX_UID:-1000}"
gid="${NGINX_GID:-1000}"

if grep -q '^webdav:' /etc/passwd; then
    sed -i "s|^webdav:[^:]*:[^:]*:[^:]*:|webdav:x:${uid}:${gid}:|" /etc/passwd
else
    echo "webdav:x:${uid}:${gid}:webdav:/nonexistent:/sbin/nologin" >> /etc/passwd
fi

if grep -q '^webdav:' /etc/group; then
    sed -i "s|^webdav:[^:]*:[^:]*:|webdav:x:${gid}:|" /etc/group
else
    echo "webdav:x:${gid}:" >> /etc/group
fi