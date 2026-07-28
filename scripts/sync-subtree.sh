#!/usr/bin/env bash
# Sync git subtrees listed in subtrees.yaml (pull/push/remotes/status).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${SUBTREES_CONFIG:-$ROOT/subtrees.yaml}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [name]

Commands:
  remotes              Add or update git remotes from subtrees.yaml
  status [name]        Compare local subtree paths with upstream HEAD
  pull <name|--all>    Pull upstream changes into the monorepo
  push <name>          Push monorepo subtree changes upstream (use with care)

Examples:
  $(basename "$0") remotes
  $(basename "$0") pull zarr-viewer
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

cmd_remotes() {
  require_config
  cd "$ROOT"
  local name
  for name in $(list_subtree_names); do
    ensure_remote "$(get_subtree_field "$name" remote_name)" "$(get_subtree_field "$name" remote)"
  done
}

cmd_status_one() {
  local name="$1"
  local path remote_name branch squash upstream local_commit
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"
  squash="$(get_subtree_field "$name" squash)"
  upstream="$(git ls-remote "$remote_name" "refs/heads/$branch" 2>/dev/null | awk '{print $1}')"
  local_commit="$(git log -1 --format=%H -- "$path" 2>/dev/null || true)"
  printf '%-22s %-28s upstream=%s\n' "$name" "$path" "${upstream:-unknown}"
  printf '%-22s %-28s local=%s\n' "" "" "${local_commit:-none}"
  if [[ -n "${upstream:-}" && -n "${local_commit:-}" ]]; then
    if git merge-base --is-ancestor "$upstream" "$local_commit" 2>/dev/null; then
      printf '%-22s %-28s state=up to date or ahead\n' "" ""
    else
      printf '%-22s %-28s state=upstream has new commits\n' "" ""
    fi
  fi
  [[ "$squash" == "true" ]] && printf '%-22s %-28s note=squash subtree\n' "" ""
}

cmd_status() {
  require_config
  cd "$ROOT"
  cmd_remotes >/dev/null
  local name="${1:-}"
  if [[ -n "$name" ]]; then
    subtree_exists "$name" || die "unknown subtree: $name"
    cmd_status_one "$name"
    return
  fi
  for name in $(list_subtree_names); do
    cmd_status_one "$name"
    echo
  done
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

cmd_push_one() {
  local name="$1"
  local path remote_name branch squash squash_flag
  path="$(get_subtree_field "$name" path)"
  remote_name="$(get_subtree_field "$name" remote_name)"
  branch="$(get_subtree_field "$name" branch)"
  squash="$(get_subtree_field "$name" squash)"
  squash_flag=()
  [[ "$squash" == "true" ]] && squash_flag=(--squash)
  echo "Pushing $name from $path to $remote_name/$branch"
  git subtree push --prefix="$path" "$remote_name" "$branch" "${squash_flag[@]}"
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

main() {
  local command="${1:-}"
  shift || true
  case "$command" in
    remotes) cmd_remotes ;;
    status) cmd_status "${1:-}" ;;
    pull) cmd_pull "${1:-}" ;;
    push) cmd_push "${1:-}" ;;
    -h|--help|help|"") usage ;;
    *) die "unknown command: $command" ;;
  esac
}

main "$@"
