#!/usr/bin/env bash
# Sync git subtrees listed in subtrees.yaml (pull/push/remotes/status).
#
# Workflow (standalone repos are the source of truth):
#   1. Develop in the standalone repo, push to its remote.
#   2. In this monorepo: ./scripts/sync-subtree.sh pull <name>
#   3. Use push only for monorepo-only changes (exports via rsync + subtree pull reconcile).
#
# git subtree push/split fails on this monorepo (recursion depth); push uses content export instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${SUBTREES_CONFIG:-$ROOT/subtrees.yaml}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [name]

Commands:
  remotes              Add or update git remotes from subtrees.yaml
  status [name]        Compare local subtree paths with upstream (tree + git link)
  pull <name|--all>    Pull upstream changes into the monorepo
  push <name>          Export monorepo changes upstream, then reconcile (use with care)
  push-content <name>  Export only (no reconcile); mainly for debugging

Examples:
  $(basename "$0") remotes
  $(basename "$0") pull stac-generator
  $(basename "$0") pull --all
  $(basename "$0") status
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

require_config() {
  [[ -f "$CONFIG" ]] || die "missing config: $CONFIG"
}

list_subtree_names() {
  awk '
    /^  [a-zA-Z0-9._-]+:$/ {
      name = $1
      sub(/:$/, "", name)
      print name
    }
  ' "$CONFIG"
}

get_subtree_field() {
  local name="$1"
  local field="$2"
  awk -v name="$name" -v field="$field" '
    $0 ~ "^  " name ":$" { in_block = 1; next }
    in_block && $0 ~ /^  [a-zA-Z0-9._-]+:$/ { in_block = 0 }
    in_block && $0 ~ "^    " field ": " {
      value = $0
      sub(/^    [^:]+: /, "", value)
      print value
      exit
    }
  ' "$CONFIG"
}

subtree_exists() {
  local name="$1"
  list_subtree_names | grep -Fxq "$name"
}

ensure_remote() {
  local remote_name="$1"
  local remote_url="$2"
  if git remote | grep -Fxq "$remote_name"; then
    local current
    current="$(git remote get-url "$remote_name")"
    if [[ "$current" != "$remote_url" ]]; then
      echo "Updating remote $remote_name -> $remote_url"
      git remote set-url "$remote_name" "$remote_url"
    fi
  else
    echo "Adding remote $remote_name -> $remote_url"
    git remote add "$remote_name" "$remote_url"
  fi
}

fetch_subtree_upstream() {
  local remote_name="$1"
  local branch="$2"
  git fetch "$remote_name" "$branch"
}

upstream_sha() {
  local remote_name="$1"
  local branch="$2"
  git rev-parse "$remote_name/$branch"
}

upstream_tree() {
  local remote_name="$1"
  local branch="$2"
  git rev-parse "$remote_name/$branch^{tree}"
}

local_tree() {
  local path="$1"
  git rev-parse "HEAD:$path"
}

trees_match() {
  local remote_name="$1"
  local branch="$2"
  local path="$3"
  [[ "$(upstream_tree "$remote_name" "$branch")" == "$(local_tree "$path")" ]]
}

upstream_is_ancestor_of_head() {
  local remote_name="$1"
  local branch="$2"
  git merge-base --is-ancestor "$remote_name/$branch" HEAD
}

subtree_is_synced() {
  local remote_name="$1"
  local branch="$2"
  local path="$3"
  trees_match "$remote_name" "$branch" "$path" \
    && upstream_is_ancestor_of_head "$remote_name" "$branch"
}

subtree_sync_state() {
  local name="$1"
  local path remote_name branch upstream local_commit up_tree loc_tree
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"

  fetch_subtree_upstream "$remote_name" "$branch" >/dev/null 2>&1

  upstream="$(upstream_sha "$remote_name" "$branch")"
  local_commit="$(git log -1 --format=%H -- "$path" 2>/dev/null || true)"
  up_tree="$(upstream_tree "$remote_name" "$branch")"
  loc_tree="$(local_tree "$path")"

  printf '%-22s %-28s upstream=%s\n' "$name" "$path" "$upstream"
  printf '%-22s %-28s local=%s\n' "" "" "${local_commit:-none}"
  printf '%-22s %-28s upstream_tree=%s\n' "" "" "$up_tree"
  printf '%-22s %-28s local_tree=%s\n' "" "" "$loc_tree"

  if [[ "$up_tree" == "$loc_tree" ]]; then
    if upstream_is_ancestor_of_head "$remote_name" "$branch"; then
      printf '%-22s %-28s state=in sync\n' "" ""
      return 0
    fi
    printf '%-22s %-28s state=content in sync, history diverged\n' "" ""
    return 1
  fi

  if upstream_is_ancestor_of_head "$remote_name" "$branch"; then
    local ahead
    ahead="$(git rev-list --count "$remote_name/$branch..HEAD" -- "$path")"
    printf '%-22s %-28s state=local ahead (%s commits)\n' "" "" "$ahead"
    return 1
  fi

  local behind
  behind="$(git rev-list --count "HEAD..$remote_name/$branch" 2>/dev/null || echo "?")"
  if [[ "$behind" != "0" ]]; then
    printf '%-22s %-28s state=upstream ahead (%s commits)\n' "" "" "$behind"
    return 1
  fi

  printf '%-22s %-28s state=diverged\n' "" ""
  return 1
}

cmd_remotes() {
  require_config
  cd "$ROOT"
  local name
  for name in $(list_subtree_names); do
    ensure_remote "$(get_subtree_field "$name" remote_name)" "$(get_subtree_field "$name" remote)"
  done
}

cmd_status_one() {
  subtree_sync_state "$1"
}

cmd_status() {
  require_config
  cd "$ROOT"
  cmd_remotes >/dev/null
  local name="${1:-}"
  local ok=0
  if [[ -n "$name" ]]; then
    subtree_exists "$name" || die "unknown subtree: $name"
    subtree_sync_state "$name" || ok=1
    return "$ok"
  fi
  for name in $(list_subtree_names); do
    subtree_sync_state "$name" || ok=1
    echo
  done
  return "$ok"
}

cmd_pull_one() {
  local name="$1"
  local path remote_name branch squash squash_flag
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"
  squash="$(get_subtree_field "$name" squash)"
  squash_flag=()
  [[ "$squash" == "true" ]] && squash_flag=(--squash)

  fetch_subtree_upstream "$remote_name" "$branch"
  if subtree_is_synced "$remote_name" "$branch" "$path"; then
    echo "$name: already in sync"
    return 0
  fi

  echo "Pulling $name from $remote_name/$branch into $path"
  git subtree pull --prefix="$path" "$remote_name" "$branch" "${squash_flag[@]}" \
    -m "Sync subtree $name from $remote_name/$branch"
}

cmd_pull() {
  require_config
  cd "$ROOT"
  cmd_remotes >/dev/null
  local target="${1:-}"
  [[ -n "$target" ]] || die "missing subtree name (or use --all)"
  if [[ "$target" == "--all" ]]; then
    local name
    for name in $(list_subtree_names); do
      cmd_pull_one "$name"
    done
    return
  fi
  subtree_exists "$target" || die "unknown subtree: $target"
  cmd_pull_one "$target"
}

rsync_subtree_to_dir() {
  local src="$1"
  local dest="$2"
  rsync -a --delete \
    --exclude '.venv' \
    --exclude '.pytest_cache' \
    --exclude '__pycache__' \
    --exclude '.git' \
    "$src/" "$dest/"
}

# Export monorepo prefix to upstream remote. Returns 0 if a new commit was pushed.
export_subtree_upstream() {
  local name="$1"
  local path remote_name branch remote_url message tmpdir pushed=1
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"
  remote_url="$(get_subtree_field "$name" remote)"
  message="$(git log -1 --format=%B -- "$path")"
  [[ -n "$message" ]] || message="Sync subtree $name from monorepo."

  tmpdir="$(mktemp -d)"
  git clone --branch "$branch" --single-branch "$remote_url" "$tmpdir/repo"
  rsync_subtree_to_dir "$ROOT/$path" "$tmpdir/repo"

  cd "$tmpdir/repo"
  if git diff --quiet && git diff --cached --quiet; then
    rm -rf "$tmpdir"
    return 1
  fi

  git add -A
  git commit -m "$message"
  git push origin "$branch"
  rm -rf "$tmpdir"
  return 0
}

reconcile_subtree_pull() {
  local name="$1"
  local path remote_name branch squash squash_flag
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"
  squash="$(get_subtree_field "$name" squash)"
  squash_flag=()
  [[ "$squash" == "true" ]] && squash_flag=(--squash)

  fetch_subtree_upstream "$remote_name" "$branch"
  git subtree pull --prefix="$path" "$remote_name" "$branch" "${squash_flag[@]}" \
    -m "Reconcile subtree $name with $remote_name/$branch after export"
}

cmd_push_one() {
  local name="$1"
  local path remote_name branch
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"

  fetch_subtree_upstream "$remote_name" "$branch"
  if subtree_is_synced "$remote_name" "$branch" "$path"; then
    echo "$name: already in sync"
    return 0
  fi

  echo "Pushing $name from $path to $remote_name/$branch (content export + reconcile)"
  if export_subtree_upstream "$name"; then
    echo "Exported new commit to $remote_name/$branch"
  else
    echo "No content changes to export; reconciling git history"
  fi
  reconcile_subtree_pull "$name"
}

cmd_push_content_one() {
  local name="$1"
  local path remote_name branch
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"

  fetch_subtree_upstream "$remote_name" "$branch"
  if subtree_is_synced "$remote_name" "$branch" "$path"; then
    echo "$name: already in sync"
    return 0
  fi

  echo "Exporting $name from $path to $remote_name/$branch (content only)"
  if export_subtree_upstream "$name"; then
    echo "Exported new commit to $remote_name/$branch"
  else
    echo "No changes to push; upstream already matches local $path."
  fi
}

cmd_push() {
  require_config
  cd "$ROOT"
  cmd_remotes >/dev/null
  local target="${1:-}"
  [[ -n "$target" ]] || die "missing subtree name"
  subtree_exists "$target" || die "unknown subtree: $target"
  cmd_push_one "$target"
}

cmd_push_content() {
  require_config
  cd "$ROOT"
  cmd_remotes >/dev/null
  local target="${1:-}"
  [[ -n "$target" ]] || die "missing subtree name"
  subtree_exists "$target" || die "unknown subtree: $target"
  cmd_push_content_one "$target"
}

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    remotes) cmd_remotes ;;
    status)
      cmd_status "${1:-}"
      exit $?
      ;;
    pull) cmd_pull "${1:-}" ;;
    push) cmd_push "${1:-}" ;;
    push-content) cmd_push_content "${1:-}" ;;
    -h|--help|help|"") usage ;;
    *) die "unknown command: $command" ;;
  esac
}

main "$@"
