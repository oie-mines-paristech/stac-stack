#!/usr/bin/env bash
# Compare services/stac-browser/ against the pre-migration backup branch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_BRANCH="${STAC_BROWSER_BACKUP_BRANCH:-backup/stac-browser-squash-20260728}"

cd "$ROOT"

if ! git rev-parse --verify "$BACKUP_BRANCH" >/dev/null 2>&1; then
  echo "error: backup branch not found: $BACKUP_BRANCH" >&2
  exit 1
fi

TMPA="$(mktemp -d)"
TMPB="$(mktemp -d)"
trap 'rm -rf "$TMPA" "$TMPB"' EXIT

git archive "$BACKUP_BRANCH" services/stac-browser | tar -x -C "$TMPA"
git archive HEAD services/stac-browser | tar -x -C "$TMPB"

if diff -rq "$TMPA/services/stac-browser" "$TMPB/services/stac-browser"; then
  echo "OK: services/stac-browser matches $BACKUP_BRANCH"
else
  echo "FAIL: tree differs from $BACKUP_BRANCH" >&2
  exit 1
fi
