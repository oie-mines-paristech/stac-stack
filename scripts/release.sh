#!/usr/bin/env bash
# Release guard rail for stac-stack.
#
# A published image must be traceable to an exact, committed source state —
# including the three submodules, whose pinned SHAs are part of the parent's
# tree. This script refuses to release anything that is not committed, and
# stamps the git revision into every image as org.opencontainers.image.revision.
#
#   scripts/release.sh check              # guard only, no side effect
#   scripts/release.sh release <version>  # guard, git tag, build, push
#
# `check` is what CI should run as a blocking gate.
set -euo pipefail

cd "$(dirname "$0")/.."
STACK_REGISTRY="${STACK_REGISTRY:-ghcr.io/oie-mines-paristech}"

die() { printf 'release: %s\n' "$*" >&2; exit 1; }
ok()  { printf '  ok  %s\n' "$*"; }
bad() { printf '  KO  %s\n' "$*"; }

# ---------------------------------------------------------------- guard rail
check() {
  local rc=0

  # (1) Parent working tree, ignoring submodule lines — those are reported (2)
  # with a message that says what to do about them.
  local dirty subs
  dirty=$(git status --porcelain | grep -vE '^.. services/(stac-generator|zarr-subset-zip|zarr-viewer)$' || true)
  if [ -n "$dirty" ]; then
    bad "uncommitted changes in the working tree:"
    printf '%s\n' "$dirty" | sed 's/^/        /'
    rc=1
  else
    ok "working tree clean"
  fi

  # (2) + (3) Each submodule, twice over: its *content* may be dirty even while
  # HEAD matches the parent index, and its HEAD may differ from the gitlink the
  # parent records. git status conflates the two, `git submodule status` splits them.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    local marker="${line:0:1}" sha="${line:1:40}" path
    path="${line:42}"; path="${path%% *}"
    case "$marker" in
      +) bad "submodule $path is at $sha but the parent records another commit — run: git add $path"; rc=1; continue ;;
      -) bad "submodule $path is not initialised — run: git submodule update --init --recursive"; rc=1; continue ;;
      U) bad "submodule $path has merge conflicts"; rc=1; continue ;;
    esac
    if [ -n "$(git -C "$path" status --porcelain)" ]; then
      bad "submodule $path has uncommitted changes ($sha) — commit in the submodule, then git add $path"
      git -C "$path" status --porcelain | sed 's/^/        /'
      rc=1
    else
      ok "submodule $path pinned and clean at ${sha:0:12}"
    fi
  done <<< "$(git submodule status)"

  # A detached HEAD is releasable (CI often checks out a SHA) but must not be
  # silent about it, since there is no branch to fall back to.
  if git symbolic-ref -q HEAD >/dev/null; then
    ok "on branch $(git rev-parse --abbrev-ref HEAD)"
  else
    printf '  --  detached HEAD at %s\n' "$(git rev-parse --short HEAD)"
  fi

  if [ "$rc" -ne 0 ]; then
    die "refusing to release: commit and push first (see above)"
  fi
  ok "source state is fully committed"
}

version_of() {
  # Version comes from the tag, never typed free-hand: the tag is the record.
  git describe --tags --exact-match 2>/dev/null \
    || die "HEAD has no git tag — run: scripts/release.sh release <version>"
}

# ----------------------------------------------------------------------- push
# `release` can be bypassed by a bare `docker push`, so the guard is enforced on
# the image itself: a locally built image carries `unreleased` unless it was
# built by `release`, and nothing gets pushed unless its revision is HEAD.
cmd_push() {
  local image="${1:?usage: scripts/release.sh push <image>}" rev label
  rev=$(git rev-parse HEAD)
  for image in "$@"; do
    label=$(docker image inspect "$image" \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null) \
      || die "$image: not present locally"
    [ "$label" = "$rev" ] \
      || die "$image: revision '$label' != HEAD '${rev:0:12}' — build it with scripts/release.sh release <version>"
  done
  for image in "$@"; do
    printf '  -> push %s\n' "$image"
    docker push "$image"
  done
}

# ------------------------------------------------------------------- release
cmd_release() {
  local version="${1:?usage: scripts/release.sh release <version>}"
  case "$version" in
    v[0-9]*|[0-9]*) ;;
    *) die "version '$version' must start with a digit or 'v' (e.g. 2026.09.30 or v1.0.0)" ;;
  esac

  check

  local rev
  rev=$(git rev-parse HEAD)

  # An existing tag is only acceptable if it already points at HEAD: that is a
  # pre-pushed tag for this exact commit. A tag anywhere else means the version
  # was already released from different source, so refuse.
  if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
    local tagged
    tagged=$(git rev-list -n1 "$version")
    [ "$tagged" = "$rev" ] || die "tag $version already exists at ${tagged:0:12}, not HEAD ${rev:0:12} — pick a new version"
    printf '  ..  tag %s already present at HEAD, reusing it\n' "$version"
  fi

  printf '\nrelease: %s @ %s\n' "$version" "${rev:0:12}"

  # Bump the committed VERSION record before tagging, so a clone at this tag
  # resolves to the images we are about to push. Done before the tag so the tag
  # always describes the tree that carries it.
  if [ "$(cat VERSION 2>/dev/null || true)" != "$version" ]; then
    printf '  -> bump VERSION -> %s\n' "$version"
    printf '%s\n' "$version" > VERSION
  else
    printf '  ..  VERSION already at %s\n' "$version"
  fi

  # Stamp the revision on the images before building: provenance must describe
  # the commit we just verified, not the one someone types in later.
  export STACK_REVISION="$rev"
  export STACK_VERSION="$version"
  export STACK_REGISTRY

  local tags
  tags=$(docker compose config --format json | python3 -c '
import json, sys
svc = json.load(sys.stdin)["services"]
for n, s in sorted(svc.items()):
    if s.get("build"):
        print(s["image"])
')

  printf '  -> building %d images\n' "$(printf '%s\n' "$tags" | wc -l)"
  docker compose build

  local image
  for image in $tags; do
    printf '  -> push %s\n' "$image"
    docker push "$image"
    # Also move `latest` so a clone that runs plain `docker compose up` — with no
    # VERSION resolved — lands on this release instead of a missing tag.
    local latest="${image%:*}:latest"
    docker tag "$image" "$latest"
    printf '  -> push %s\n' "$latest"
    docker push "$latest"
  done

  # Tag only after every image is published, so a failed build or a partial
  # push never leaves a version tag pointing at an unpublished commit.
  if ! git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
    printf '  -> tag %s\n' "refs/tags/$version"
    git tag -a "$version" -m "stac-stack $version @ ${rev:0:12}"
  else
    printf '  -> tag %s already present\n' "$version"
  fi

  printf '\nrelease: done.\n'
  printf '  images : %s:%s (+ :latest)\n' "$STACK_REGISTRY" "$version"
  printf '  git tag: %s (pushed? -> git push origin %s)\n' "$version" "$version"
  printf '  verify : docker image inspect --format "{{index .Config.Labels \\"org.opencontainers.image.revision\\"}}" \\\n'
  printf '             %s/stac-stack-nginx:%s\n' "$STACK_REGISTRY" "$version"

  # VERSION was bumped above, so the tree is no longer clean. Commit it here and
  # leave pushing to the caller, rather than leaving a dirty tree that would make
  # the next release-check fail.
  if ! git diff --quiet -- VERSION; then
    printf '  -> commit VERSION bump\n'
    git add VERSION
    git commit -q -m "release: bump VERSION to $version"
    printf '     remember to push: git push origin main\n'
  fi
}

case "${1:-}" in
  check)   check ;;
  release) shift; cmd_release "$@" ;;
  push)    shift; cmd_push "$@" ;;
  *) echo "usage: $0 {check|release <version>|push <image>}" >&2; exit 2 ;;
esac