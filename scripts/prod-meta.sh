#!/usr/bin/env bash
# Manage the local git clone of the *prod metadata* (volumes/data-meta/).
#
#   scripts/prod-meta.sh clone    # clone (or fast-forward) from the prod repo
#   scripts/prod-meta.sh pull     # fast-forward the local clone from prod
#   scripts/prod-meta.sh push     # deploy local commits to prod (updates the served tree)
#   scripts/prod-meta.sh status   # show the clone's git status
#
# The prod repo's working tree is volumes/data/ on the prod host, whose contents
# are exactly what nginx serves (davs://…/dav/data) and what the generator reads.
# Its git-dir may live elsewhere (e.g. `git init --separate-git-dir=/root/stac-meta.git`):
# the worktree keeps a `.git` file pointing at it, so cloning/pushing the worktree
# path still works. The repo tracks only metadata (*.yml) plus small illustrations
# (png/jpg/pdf/ipynb); the datasets are NOT in git (see its .gitignore).
#
# Env:
#   PROD_META_REMOTE  git remote of the prod metadata repo
#                     (default: stac:~/stac/volumes/data)
#   PROD_META_DIR     local clone path (default: volumes/data-meta)
#
# Deploying by push requires the prod repo to accept a push into its checked-out
# branch, i.e. on the prod host, once:
#   git -C ~/stac/volumes/data config receive.denyCurrentBranch updateInstead
# (colleagues editing directly over WebDAV must have committed/cleaned first, or
#  the push is refused to protect their in-tree changes).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
META_DIR="${PROD_META_DIR:-$ROOT/volumes/data-meta}"
REMOTE="${PROD_META_REMOTE:-stac:~/stac/volumes/data}"

require_git() {
  command -v git >/dev/null 2>&1 || { echo "git is required." >&2; exit 1; }
}

require_clone() {
  [ -d "$META_DIR/.git" ] || {
    echo "No metadata clone at $META_DIR — run '$0 clone' first." >&2
    exit 1
  }
}

do_clone() {
  require_git
  if [ -d "$META_DIR/.git" ]; then
    echo "already cloned: $META_DIR — fast-forwarding"
    git -C "$META_DIR" pull --ff-only
  else
    echo "cloning $REMOTE -> $META_DIR"
    git clone "$REMOTE" "$META_DIR"
  fi
}

do_pull() { require_git; require_clone; git -C "$META_DIR" pull --ff-only; }
do_push() { require_git; require_clone; git -C "$META_DIR" push; }
do_status() { require_git; require_clone; git -C "$META_DIR" status -sb; }

case "${1:-}" in
  clone) do_clone ;;
  pull) do_pull ;;
  push) do_push ;;
  status) do_status ;;
  *)
    echo "usage: $0 {clone|pull|push|status}" >&2
    exit 2
    ;;
esac
