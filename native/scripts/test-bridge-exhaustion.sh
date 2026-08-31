#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
cd "$repo_root"

cc_bin="${CC:-cc}"
out_dir="$(mktemp -d)"
cleanup() {
	rm -f -- "$out_dir/bridge_exhaustion_test" "$out_dir/bridge_exhaustion_test.exe"
	rmdir -- "$out_dir"
}
trap cleanup EXIT

sources=()
while IFS= read -r -d '' source_file; do
	sources+=("$source_file")
done < <(find native/box3d/src -type f -name '*.c' -print0 | LC_ALL=C sort -z)

if [[ "${#sources[@]}" -eq 0 ]]; then
	echo "ERROR: no vendored Box3D C sources found under native/box3d/src." >&2
	exit 1
fi

"$cc_bin" \
	-std=c17 \
	-O0 \
	-g \
	-Wall \
	-Wextra \
	-Wpedantic \
	-Wno-unused-value \
	-DBOX3D_DISABLE_SIMD \
	-I native/box3d/include \
	-I native/box3d/src \
	"${sources[@]}" \
	native/test/bridge_exhaustion_test.c \
	-lm \
	-o "$out_dir/bridge_exhaustion_test"

"$out_dir/bridge_exhaustion_test"
