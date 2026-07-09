#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/erincatto/box3d.git"
DEFAULT_COMMIT="8441b4a06d6d09dcfb0b0f704df4d847d1437b92"

usage() {
  printf '%s\n' \
    "Usage: native/scripts/fetch-box3d.sh [--help]" \
    "" \
    "Clone erincatto/box3d into native/box3d at the pinned commit." \
    "" \
    "Environment overrides:" \
    "  BOX3D_REPO_URL   Git repository URL" \
    "  BOX3D_COMMIT     Exact 40-character commit to check out"
}

die() {
  echo "fetch-box3d: error: $*" >&2
  exit 1
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  "") ;;
  *) die "unknown argument: $1" ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(git -C "$script_dir/../.." rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  repo_root="$(cd "$script_dir/../.." && pwd -P)"
fi

version_file="$repo_root/native/BOX3D_VERSION"
target_dir="$repo_root/native/box3d"
repo_url="${BOX3D_REPO_URL-$DEFAULT_REPO_URL}"
[[ -n "$repo_url" ]] || die "BOX3D_REPO_URL must not be empty"

commit_from_file=""
if [[ -f "$version_file" ]]; then
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*Commit:[[:space:]]*([0-9a-fA-F]{40}) ]]; then
      commit_from_file="${BASH_REMATCH[1]}"
      break
    elif [[ -z "$commit_from_file" && "$line" =~ ^[[:space:]]*([0-9a-fA-F]{40})[[:space:]]*$ ]]; then
      commit_from_file="${BASH_REMATCH[1]}"
    fi
  done < "$version_file"
fi

if [[ -n "${BOX3D_COMMIT+x}" ]]; then
  commit="$BOX3D_COMMIT"
else
  commit="${commit_from_file:-$DEFAULT_COMMIT}"
fi
[[ "$commit" =~ ^[0-9a-fA-F]{40}$ ]] ||
  die "BOX3D_COMMIT must resolve to an exact 40-character commit: $commit"
commit="${commit,,}"

echo "Box3D repo: $repo_url"
echo "Box3D commit: $commit"

if [[ -e "$target_dir/.git" ]]; then
  current_head="$(git -C "$target_dir" rev-parse HEAD 2>/dev/null || true)"
  if [[ "$current_head" == "$commit" ]]; then
    echo "native/box3d already matches pinned commit; skipping clone."
    echo "Box3D fetch complete at $commit."
    exit 0
  fi
fi
rm -rf "$target_dir"
# Full clone: arbitrary pinned commits may not be reachable in shallow clones.
git clone "$repo_url" "$target_dir"
git -C "$target_dir" checkout "$commit"

actual_head="$(git -C "$target_dir" rev-parse HEAD)"
[[ "$actual_head" == "$commit" ]] ||
  die "checkout verification failed: expected $commit, got $actual_head"
echo "Box3D fetch complete at $commit."
