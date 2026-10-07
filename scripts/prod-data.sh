#!/usr/bin/env bash
# Mount the *prod* STAC input tree read-only at volumes/data-prod/, as an overlay:
#   { local metadata clone (git) }  ∪  { prod data (WebDAV, read-only) }.
#
#   scripts/prod-data.sh mount    # ensure the overlay mount is up (idempotent)
#   scripts/prod-data.sh umount   # unmount it
#   scripts/prod-data.sh status   # show mount state
#
# The local branch (volumes/data-meta/, see scripts/prod-meta.sh) wins for every
# file it contains — i.e. your edited metadata.yml, images, notebooks. Everything
# else (the datasets) is read from prod. The mount is READ-ONLY: the generator
# only reads, and metadata is edited in the git worktree, outside the mount.
#
# Env:
#   PROD_WEBDAV_URL   WebDAV URL of the prod *input root*
#                     (default: https://stac.webservice-energy.org/data — public read)
#   PROD_WEBDAV_USER  prod WebDAV login (fallback: WEBDAV_ADMIN in .env)
#   PROD_WEBDAV_PASS  prod WebDAV password (fallback: WEBDAV_PASSWORD in .env)
#                     Only needed when the URL points at the admin root (/dav).
#   PROD_META_DIR     local metadata clone (default: volumes/data-meta)
#
# volumes/data-prod/ and volumes/data-meta/ are gitignored; the rclone config/log
# live in .cache/ (also gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOUNT_DIR="${PROD_MOUNT:-$ROOT/volumes/data-prod}"
META_DIR="${PROD_META_DIR:-$ROOT/volumes/data-meta}"
CONF="$ROOT/.cache/rclone-prod.conf"
LOG="$ROOT/.cache/rclone-prod.log"
REMOTE="prod"
OVERLAY="prod-overlay"
URL="${PROD_WEBDAV_URL:-https://stac.webservice-energy.org/data}"

has_meta() { [ -d "$META_DIR/.git" ]; }
is_mounted() { mountpoint -q "$MOUNT_DIR" 2>/dev/null; }

# Read one KEY=value from the repo .env without sourcing it (values may contain
# '=', '#' or spaces). Strips optional surrounding quotes. Silent if absent.
read_env() {
  local line value
  line="$(grep -m1 -E "^[[:space:]]*$1=" "$ROOT/.env" 2>/dev/null || true)"
  [ -n "$line" ] || return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

require_rclone() {
  command -v rclone >/dev/null 2>&1 || {
    echo "rclone is required (e.g. 'sudo apt install rclone')." >&2
    exit 1
  }
}

write_config() {
  mkdir -p "$(dirname "$CONF")"

  # The public /data root needs no auth; /dav does. Add credentials only then.
  local -a creds=()
  case "$URL" in
    */dav/* | */dav)
      local user="${PROD_WEBDAV_USER:-}" pass="${PROD_WEBDAV_PASS:-}"
      if [ -z "$user" ]; then user="$(read_env WEBDAV_ADMIN)"; fi
      if [ -z "$pass" ]; then pass="$(read_env WEBDAV_PASSWORD)"; fi
      if [ -z "$user" ] || [ -z "$pass" ]; then
        echo "The URL targets the admin root; set PROD_WEBDAV_USER/PROD_WEBDAV_PASS" >&2
        echo "or WEBDAV_ADMIN/WEBDAV_PASSWORD in $ROOT/.env." >&2
        exit 1
      fi
      creds=("user=$user" "pass=$(rclone obscure "$pass")")
      echo "  auth: $user (/dav admin root)"
      ;;
    *) echo "  auth: none (public read root)" ;;
  esac

  rclone --config "$CONF" config create "$REMOTE" webdav \
    url="$URL" vendor=other "${creds[@]}" --non-interactive >/dev/null

  if has_meta; then
    rclone --config "$CONF" config create "$OVERLAY" union \
      upstreams="$META_DIR $REMOTE:" \
      search_policy=ff action_policy=epall create_policy=ff \
      --non-interactive >/dev/null
  fi
}

do_mount() {
  require_rclone
  if is_mounted; then
    echo "already mounted: $MOUNT_DIR"
    return 0
  fi

  # The containers read the FUSE mount as another uid, so rclone needs
  # --allow-other, which itself needs user_allow_other in /etc/fuse.conf.
  if ! grep -qs '^[[:space:]]*user_allow_other' /etc/fuse.conf; then
    echo "NOTE: the containers need FUSE 'allow_other'. Enable it once with:" >&2
    echo "      sudo sh -c 'echo user_allow_other >> /etc/fuse.conf'" >&2
  fi

  write_config
  mkdir -p "$MOUNT_DIR"

  local remote="$REMOTE:"
  if has_meta; then
    remote="$OVERLAY:"
    echo "overlay: $META_DIR (local metadata) + $URL (prod data), read-only"
  else
    echo "WARNING: no metadata clone at $META_DIR — serving prod data only." >&2
    echo "         run 'make prod-meta-clone' to enable local metadata." >&2
    echo "mounting $URL (read-only) at $MOUNT_DIR ..."
  fi

  rclone --config "$CONF" mount "$remote" "$MOUNT_DIR" \
    --read-only --allow-other \
    --vfs-cache-mode off --dir-cache-time 60s \
    --exclude '.git' --exclude '.git/**' \
    --daemon --daemon-wait 10s \
    --log-file "$LOG" --log-level INFO
  for _ in $(seq 1 30); do is_mounted && break; sleep 0.5; done
  if ! is_mounted; then
    echo "mount failed; see $LOG" >&2
    exit 1
  fi
  echo "mounted: $MOUNT_DIR"
}

do_umount() {
  if ! is_mounted; then
    echo "not mounted: $MOUNT_DIR"
    return 0
  fi
  fusermount3 -u "$MOUNT_DIR" 2>/dev/null || fusermount -u "$MOUNT_DIR" 2>/dev/null || umount "$MOUNT_DIR"
  echo "unmounted: $MOUNT_DIR"
}

do_status() {
  if is_mounted; then
    echo "mounted: $MOUNT_DIR (read-only)"
    echo "  prod data: $URL"
    if has_meta; then echo "  local metadata: $META_DIR"; else echo "  local metadata: (none)"; fi
  else
    echo "not mounted: $MOUNT_DIR"
  fi
}

case "${1:-}" in
  mount) do_mount ;;
  umount | unmount) do_umount ;;
  status) do_status ;;
  *)
    echo "usage: $0 {mount|umount|status}" >&2
    exit 2
    ;;
esac
