#!/usr/bin/env bash
# Mirror a GitLab commit to the GitHub clone, keeping the GitHub README headers.
#
# GitHub main = GitLab main + one commit that swaps the README header block.
# Because the mirror is rebuilt on top of the new GitLab commit, the push is a
# force-push; the GitHub repository is read-only, so nobody else writes there.
#
# Usage: scripts/sync-github-mirror.sh [ref]   (default: origin/main)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${GITHUB_MIRROR_REMOTE:-stac-stack}"
BRANCH="${GITHUB_MIRROR_BRANCH:-main}"
REF="${1:-origin/main}"

cd "$ROOT"

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "error: remote '$REMOTE' is not configured." >&2
  echo "run: git remote add $REMOTE git@github.com:oie-mines-paristech/stac-stack.git" >&2
  exit 1
fi

git fetch --quiet "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH" 2>/dev/null || true
remote_sha="$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/$BRANCH" || true)"

tmp="$(mktemp -d)"
cleanup() { git worktree remove --force "$tmp" >/dev/null 2>&1 || rm -rf "$tmp"; }
trap cleanup EXIT

git worktree add --quiet --detach "$tmp" "$REF"
"$ROOT/scripts/mirror_readme_headers.py" "$tmp"

if git -C "$tmp" diff --quiet; then
  echo "mirror: no README change, nothing to push"
  exit 0
fi

git -C "$tmp" add -A
git -C "$tmp" \
  -c user.name="STAC-OIE mirror" \
  -c user.email="stac-oie-mirror@users.noreply.github.com" \
  commit --quiet -m "docs: GitHub mirror README headers"
commit="$(git -C "$tmp" rev-parse HEAD)"

if [[ -n "$remote_sha" ]] \
  && [[ "$(git rev-parse "$commit^{tree}")" == "$(git rev-parse "$remote_sha^{tree}")" ]]; then
  echo "mirror: $REMOTE/$BRANCH is already up to date"
  exit 0
fi

export STAC_OIE_MIRROR=1
if [[ -n "$remote_sha" ]]; then
  git push --quiet --force-with-lease="refs/heads/$BRANCH:$remote_sha" \
    "$REMOTE" "$commit:refs/heads/$BRANCH"
else
  git push --quiet "$REMOTE" "$commit:refs/heads/$BRANCH"
fi
echo "mirror: pushed $(git rev-parse --short "$commit") to $REMOTE/$BRANCH"
