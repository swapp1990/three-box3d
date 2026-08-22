#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: native/scripts/build-wasm.sh [--variant compat|simd|all] [--help]

Build the vendored box3d C sources plus native/bridge.c into WASM artifacts.

Variants:
  (no args)          Default SIMD build into the legacy
                     default outputs only:
                       native/dist/box3d.js
                       native/dist/box3d.wasm
                     Uses -msimd128 -msse2. Use --variant compat for rollback.

  --variant compat   Named scalar/compat artifact only (does not touch legacy):
                       native/dist/box3d.compat.js
                       native/dist/box3d.compat.wasm

  --variant simd     Named SIMD artifact only (does not touch legacy):
                       native/dist/box3d.simd.js
                       native/dist/box3d.simd.wasm
                     Compile + link with -msimd128 -msse2 (no BOX3D_DISABLE_SIMD).

  --variant all      Build both named variants (compat + simd). Does not modify
                     the legacy default box3d.wasm / box3d.js. Also verifies
                     that both expose exactly the same runtime exports.

Required environment:
  EMSDK_DIR      Path to an emsdk checkout. Example:
                   export EMSDK_DIR=/path/to/emsdk

Optional environment:
  EMCC_TEMP_DIR  Scratch directory for emcc and temporary object files.
                 Defaults to ${TMPDIR:-/tmp}/three-box3d-emcc.

Notes:
  - This script does not vendor or install emsdk. The caller must provide it.
  - The generated .js files are emcc glue emitted as a build side-effect. The
    project ships its own hand-written runtime loader elsewhere.
  - Never uses -ffast-math. Both variants use -O3 -DNDEBUG -ffp-contract=off.
  - Object files are isolated per variant under EMCC_TEMP_DIR so they cannot mix.
EOF
}

###############################################################################
# Argument parsing
###############################################################################

variant_mode=""  # empty = default SIMD build into legacy output paths

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --variant)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --variant requires an argument (compat|simd|all)." >&2
        usage >&2
        exit 1
      fi
      variant_mode="$2"
      shift 2
      ;;
    --variant=*)
      variant_mode="${1#--variant=}"
      shift
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$variant_mode" && "$variant_mode" != "compat" && "$variant_mode" != "simd" && "$variant_mode" != "all" ]]; then
  echo "ERROR: invalid --variant '$variant_mode' (expected compat|simd|all)." >&2
  usage >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
cd "$repo_root"

# Track temporary dirs/scripts for cleanup. objs_dirs is space-separated list
# of absolute paths created during this run.
objs_dirs=()
verify_script=""
build_succeeded=0

cleanup() {
  local status=$?
  local d

  if [[ "$build_succeeded" == "1" ]]; then
    for d in "${objs_dirs[@]+"${objs_dirs[@]}"}"; do
      if [[ -n "$d" ]]; then
        rm -rf -- "$d" || true
      fi
    done
    if [[ -n "$verify_script" && -f "$verify_script" ]]; then
      rm -f -- "$verify_script" || true
    fi
  elif [[ "$status" -ne 0 ]]; then
    for d in "${objs_dirs[@]+"${objs_dirs[@]}"}"; do
      if [[ -n "$d" ]]; then
        echo "Build failed; temporary object files were left in: $d" >&2
      fi
    done
    if [[ -n "$verify_script" && -f "$verify_script" ]]; then
      echo "Verification helper was left in: $verify_script" >&2
    fi
  fi

  return "$status"
}
trap cleanup EXIT

###############################################################################
# Toolchain resolution
###############################################################################

if [[ -z "${EMSDK_DIR:-}" ]]; then
  echo "ERROR: EMSDK_DIR is required." >&2
  echo "Set it to your emsdk checkout, for example:" >&2
  echo "  export EMSDK_DIR=/path/to/emsdk" >&2
  exit 1
fi

# Prefer emcc.exe when present so Windows Git Bash/MSYS invokes the real Win32
# executable directly. Non-Windows emsdk installs normally provide emcc without
# .exe, so fall back to that if the .exe is absent. Do not use emcc.bat.
emcc_exe="$EMSDK_DIR/upstream/emscripten/emcc.exe"
emcc_posix="$EMSDK_DIR/upstream/emscripten/emcc"
if [[ -f "$emcc_exe" ]]; then
  emcc="$emcc_exe"
elif [[ -f "$emcc_posix" ]]; then
  emcc="$emcc_posix"
else
  echo "ERROR: could not find emcc under EMSDK_DIR." >&2
  echo "Looked for:" >&2
  echo "  $emcc_exe" >&2
  echo "  $emcc_posix" >&2
  exit 1
fi

echo "Using emcc: $emcc"

# Informational only. The current production artifact was reverse-engineered
# from Emscripten 6.0.2, but this script does not hard-fail on version drift.
version_file="$EMSDK_DIR/upstream/emscripten/emscripten-version.txt"
if [[ -f "$version_file" ]]; then
  emscripten_version="$(tr -d '\r\n' < "$version_file")"
  echo "Emscripten version: $emscripten_version"
else
  echo "Emscripten version: unknown ($version_file not found)"
fi

: "${EMCC_TEMP_DIR:=${TMPDIR:-/tmp}/three-box3d-emcc}"
export EMCC_TEMP_DIR
mkdir -p -- "$EMCC_TEMP_DIR"
echo "Using EMCC_TEMP_DIR=$EMCC_TEMP_DIR"

###############################################################################
# Shared source / export setup
###############################################################################

if [[ ! -d native/box3d/include || ! -d native/box3d/src ]]; then
  echo "ERROR: native/box3d/include and native/box3d/src are required." >&2
  echo "Did you run native/scripts/fetch-box3d.sh?" >&2
  exit 1
fi

if [[ ! -f native/bridge.c ]]; then
  echo "ERROR: native/bridge.c not found." >&2
  exit 1
fi

box3d_sources=()
while IFS= read -r -d '' source_file; do
  box3d_sources+=("$source_file")
done < <(find native/box3d/src -type f -name '*.c' -print0 | LC_ALL=C sort -z)

if [[ "${#box3d_sources[@]}" -eq 0 ]]; then
  echo "ERROR: no .c files found under native/box3d/src." >&2
  echo "This usually means native/scripts/fetch-box3d.sh was not run, or paths changed." >&2
  exit 1
fi

sources=("${box3d_sources[@]}" "native/bridge.c")

expected_exports_file="native/expected-exports.txt"
if [[ ! -f "$expected_exports_file" ]]; then
  echo "ERROR: $expected_exports_file not found." >&2
  exit 1
fi

exports=()
while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
  line="${raw_line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"

  if [[ -z "$line" || "${line:0:1}" == "#" ]]; then
    continue
  fi

  if [[ ! "$line" =~ ^_[A-Za-z0-9_]+$ ]]; then
    echo "ERROR: unsupported export name in $expected_exports_file: $line" >&2
    echo "Expected one Emscripten-style symbol per line, e.g. _b3bridge_create_world." >&2
    exit 1
  fi

  exports+=("'$line'")
done < "$expected_exports_file"

if [[ "${#exports[@]}" -eq 0 ]]; then
  echo "ERROR: no exports found in $expected_exports_file." >&2
  exit 1
fi

exported_functions="["
for export_name in "${exports[@]}"; do
  if [[ "$exported_functions" != "[" ]]; then
    exported_functions+=","
  fi
  exported_functions+="$export_name"
done
exported_functions+="]"

mkdir -p native/dist

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to verify WASM exports." >&2
  exit 1
fi

# Write the shared export-verification helper once per run.
verify_script="$EMCC_TEMP_DIR/verify-box3d-exports.mjs"
cat > "$verify_script" <<'NODE_EOF'
import fs from 'node:fs/promises';

const [wasmPath, expectedExportsPath, listExportsFlag] = process.argv.slice(2);

if (!wasmPath || !expectedExportsPath) {
  console.error('Usage: node verify-box3d-exports.mjs <box3d.wasm> <expected-exports.txt> [--list-exports]');
  process.exit(1);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function diff(expected, actual) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return {
    missing: expected.filter((name) => !actualSet.has(name)),
    extra: actual.filter((name) => !expectedSet.has(name)),
  };
}

function makeStubImports(module) {
  const imports = {};

  for (const descriptor of WebAssembly.Module.imports(module)) {
    const namespace = descriptor.module;
    const name = descriptor.name;

    if (!imports[namespace]) {
      imports[namespace] = {};
    }
    if (Object.prototype.hasOwnProperty.call(imports[namespace], name)) {
      continue;
    }

    if (descriptor.kind === 'function') {
      imports[namespace][name] = () => 0;
    } else if (descriptor.kind === 'memory') {
      imports[namespace][name] = new WebAssembly.Memory({ initial: 256, maximum: 65536 });
    } else if (descriptor.kind === 'table') {
      imports[namespace][name] = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
    } else if (descriptor.kind === 'global') {
      imports[namespace][name] = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
    }
  }

  if (!imports.env) {
    imports.env = {};
  }
  if (!imports.env.emscripten_notify_memory_growth) {
    imports.env.emscripten_notify_memory_growth = () => {};
  }

  if (!imports.wasi_snapshot_preview1) {
    imports.wasi_snapshot_preview1 = {};
  }
  if (!imports.wasi_snapshot_preview1.clock_time_get) {
    imports.wasi_snapshot_preview1.clock_time_get = () => 0;
  }
  if (!imports.wasi_snapshot_preview1.fd_write) {
    imports.wasi_snapshot_preview1.fd_write = () => 0;
  }

  return imports;
}

const expectedText = await fs.readFile(expectedExportsPath, 'utf8');
const expectedSymbols = expectedText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

const expectedBridgeExports = uniqueSorted(
  expectedSymbols
    .map((name) => name.replace(/^_/, ''))
    .filter((name) => name.includes('b3bridge')),
);

const wasmBytes = await fs.readFile(wasmPath);
const module = await WebAssembly.compile(wasmBytes);
const instance = await WebAssembly.instantiate(module, makeStubImports(module));
const rawExports = uniqueSorted(Object.keys(instance.exports));
const rawExportSet = new Set(rawExports);

const missingRuntimeExports = ['malloc', 'free'].filter((name) => !rawExportSet.has(name));
if (missingRuntimeExports.length > 0) {
  console.error('WASM runtime export verification failed.');
  console.error(`missing: ${missingRuntimeExports.join(', ')}`);
  process.exit(1);
}

const actualBridgeExports = rawExports.filter((name) => name.includes('b3bridge'));
const { missing, extra } = diff(expectedBridgeExports, actualBridgeExports);

if (missing.length > 0 || extra.length > 0) {
  console.error('WASM b3bridge export verification failed.');
  console.error(`missing: ${missing.length > 0 ? missing.join(', ') : '(none)'}`);
  console.error(`unexpected extra: ${extra.length > 0 ? extra.join(', ') : '(none)'}`);
  console.error(`expected (${expectedBridgeExports.length}): ${expectedBridgeExports.join(', ')}`);
  console.error(`actual (${actualBridgeExports.length}): ${actualBridgeExports.join(', ')}`);
  process.exit(1);
}

if (listExportsFlag === '--list-exports') {
  // One export name per line for cross-variant comparison (stable sorted).
  for (const name of rawExports) {
    console.log(name);
  }
} else {
  console.log(String(actualBridgeExports.length));
}
NODE_EOF

sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "<manual>"
  fi
}

# Build one named (or legacy) variant.
# Args:
#   $1  variant key: "compat" | "simd"  (controls flags + objs isolation)
#   $2  output stem under native/dist: "box3d" | "box3d.compat" | "box3d.simd"
# Prints: "<sha256> <bytes> <b3bridge_export_count>" on the last status line via globals:
#   last_wasm_sha256, last_wasm_size, last_bridge_export_count, last_wasm_file
build_one_variant() {
  local variant_key="$1"
  local output_stem="$2"
  local objs_dir
  local compile_flags
  local link_extra_flags
  local source_file
  local rel_name
  local obj_name
  local obj_file
  local objects=()
  local out_js
  local out_wasm
  local bridge_export_count

  objs_dir="$EMCC_TEMP_DIR/objs-${variant_key}-${output_stem//\//_}"
  rm -rf -- "$objs_dir"
  mkdir -p -- "$objs_dir"
  objs_dirs+=("$objs_dir")

  compile_flags=(
    -I native/box3d/include
    -I native/box3d/src
    -O3
    -DNDEBUG
    -ffp-contract=off
  )
  link_extra_flags=()

  if [[ "$variant_key" == "compat" ]]; then
    compile_flags+=(-DBOX3D_DISABLE_SIMD)
  elif [[ "$variant_key" == "simd" ]]; then
    # SIMD flags applied consistently at compile and final link.
    compile_flags+=(-msimd128 -msse2)
    link_extra_flags+=(-msimd128 -msse2)
  else
    echo "ERROR: internal: unknown variant_key '$variant_key'" >&2
    exit 1
  fi

  echo ""
  echo "=== Building variant=$variant_key -> native/dist/${output_stem}.{js,wasm} ==="
  echo "  objs: $objs_dir"
  echo "  compile: ${compile_flags[*]}"
  if [[ "${#link_extra_flags[@]}" -gt 0 ]]; then
    echo "  link extras: ${link_extra_flags[*]}"
  fi

  echo "Compiling ${#sources[@]} C files..."
  for source_file in "${sources[@]}"; do
    rel_name="${source_file#native/}"
    obj_name="${rel_name//\//__}.o"
    obj_file="$objs_dir/$obj_name"

    echo "  $source_file -> $obj_file"
    "$emcc" "${compile_flags[@]}" -c "$source_file" -o "$obj_file"
    objects+=("$obj_file")
  done

  out_js="native/dist/${output_stem}.js"
  out_wasm="native/dist/${output_stem}.wasm"

  echo "Linking $out_js and $out_wasm..."
  # TODO(phase1): docs/plan.md Phase 0 asks for -s MODULARIZE=1 -s EXPORT_ES6=1, but
  # that shape is INCOMPATIBLE with what this repo actually ships today and cannot be
  # reconciled with a flag tweak:
  #
  #   - The project's real runtime loader (ported from the old app's hand-written
  #     src/physics/dist/box3d.js) does a raw WebAssembly.instantiate() against
  #     native/dist/box3d.wasm directly. It never imports or executes emcc's
  #     generated .js glue at all.
  #   - At -O3, Emscripten minifies wasm import/export names to single letters
  #     and rewrites ONLY its own generated JS glue to match (tools/link.py,
  #     minify_wasm_imports_and_exports). A hand-written loader that bypasses the
  #     glue has no way to recover the real b3bridge_*/malloc/free names once
  #     they're minified.
  #   - The public switch to prevent that minification is
  #     -s DECLARE_ASM_MODULE_EXPORTS=0, but emcc hard-rejects that combination:
  #     "MODULARIZE is not compatible with DECLARE_ASM_MODULE_EXPORTS=0" (verified
  #     empirically against Emscripten 6.0.2 while building this script).
  #
  # So for now this script DROPS -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=...
  # and adds -s DECLARE_ASM_MODULE_EXPORTS=0 instead, which reproduces the CURRENT
  # shipped artifact shape (a bare .wasm with real, unminified b3bridge_* export
  # names, consumed by our own loader) byte-for-byte in spirit. Revisit this once
  # packages/core's typed TS loader (Phase 1) is designed: if it ends up consuming
  # emcc's own generated JS glue instead of a hand-written one, MODULARIZE=1 +
  # EXPORT_ES6=1 + EXPORT_NAME=createBox3DModule become viable again and this
  # TODO can be resolved by switching back and removing DECLARE_ASM_MODULE_EXPORTS=0.
  "$emcc" "${objects[@]}" \
    -O3 \
    "${link_extra_flags[@]+"${link_extra_flags[@]}"}" \
    -s ENVIRONMENT=web,worker \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s DECLARE_ASM_MODULE_EXPORTS=0 \
    -s "EXPORTED_FUNCTIONS=$exported_functions" \
    -o "$out_js"

  if [[ ! -f "$out_wasm" ]]; then
    echo "ERROR: expected output not found: $out_wasm" >&2
    exit 1
  fi

  last_wasm_file="$out_wasm"
  last_wasm_size="$(wc -c < "$out_wasm" | tr -d '[:space:]')"
  last_wasm_sha256="$(sha256_of "$out_wasm")"
  if [[ "$last_wasm_sha256" == "<manual>" ]]; then
    echo "WARNING: sha256sum and shasum were not found; please compute SHA256 manually for $out_wasm." >&2
  fi

  echo "WASM SHA256: $last_wasm_sha256"
  echo "WASM bytes: $last_wasm_size"

  bridge_export_count="$(node "$verify_script" "$out_wasm" "$expected_exports_file")"
  last_bridge_export_count="$bridge_export_count"

  echo "OK: variant=$variant_key file=$out_wasm sha256=$last_wasm_sha256 bytes=$last_wasm_size b3bridge_exports=$bridge_export_count"
}

# Compare full runtime export sets between two wasm files (used by --variant all).
verify_export_parity() {
  local wasm_a="$1"
  local wasm_b="$2"
  local list_a
  local list_b
  local tmp_a
  local tmp_b

  tmp_a="$EMCC_TEMP_DIR/exports-a.txt"
  tmp_b="$EMCC_TEMP_DIR/exports-b.txt"

  node "$verify_script" "$wasm_a" "$expected_exports_file" --list-exports > "$tmp_a"
  node "$verify_script" "$wasm_b" "$expected_exports_file" --list-exports > "$tmp_b"

  if ! cmp -s "$tmp_a" "$tmp_b"; then
    echo "ERROR: runtime export sets differ between variants." >&2
    echo "  $wasm_a" >&2
    echo "  $wasm_b" >&2
    echo "--- exports ($wasm_a) ---" >&2
    cat "$tmp_a" >&2
    echo "--- exports ($wasm_b) ---" >&2
    cat "$tmp_b" >&2
    echo "--- diff ---" >&2
    diff -u "$tmp_a" "$tmp_b" >&2 || true
    rm -f -- "$tmp_a" "$tmp_b"
    exit 1
  fi

  rm -f -- "$tmp_a" "$tmp_b"
  echo "OK: export parity — $wasm_a and $wasm_b expose identical runtime exports"
}

###############################################################################
# Dispatch
###############################################################################

last_wasm_file=""
last_wasm_sha256=""
last_wasm_size=""
last_bridge_export_count=""

case "${variant_mode:-}" in
  "")
    # Promoted default: SIMD into legacy artifact paths consumed by packages/apps.
    # The named compat variant remains the explicit scalar rollback path.
    build_one_variant "simd" "box3d"
    build_succeeded=1
    echo ""
    echo "OK: wasm_sha256=$last_wasm_sha256 bytes=$last_wasm_size b3bridge_exports=$last_bridge_export_count"
    ;;
  compat)
    build_one_variant "compat" "box3d.compat"
    build_succeeded=1
    echo ""
    echo "OK: variant=compat wasm_sha256=$last_wasm_sha256 bytes=$last_wasm_size b3bridge_exports=$last_bridge_export_count"
    ;;
  simd)
    build_one_variant "simd" "box3d.simd"
    build_succeeded=1
    echo ""
    echo "OK: variant=simd wasm_sha256=$last_wasm_sha256 bytes=$last_wasm_size b3bridge_exports=$last_bridge_export_count"
    ;;
  all)
    # Named artifacts only — never overwrite legacy native/dist/box3d.wasm.
    build_one_variant "compat" "box3d.compat"
    compat_sha="$last_wasm_sha256"
    compat_size="$last_wasm_size"
    compat_exports="$last_bridge_export_count"
    compat_file="$last_wasm_file"

    build_one_variant "simd" "box3d.simd"
    simd_sha="$last_wasm_sha256"
    simd_size="$last_wasm_size"
    simd_exports="$last_bridge_export_count"
    simd_file="$last_wasm_file"

    verify_export_parity "$compat_file" "$simd_file"

    build_succeeded=1
    echo ""
    echo "=== Variant summary (legacy box3d.wasm untouched) ==="
    echo "compat: $compat_file"
    echo "  SHA256: $compat_sha"
    echo "  bytes:  $compat_size"
    echo "  b3bridge_exports: $compat_exports"
    echo "simd:   $simd_file"
    echo "  SHA256: $simd_sha"
    echo "  bytes:  $simd_size"
    echo "  b3bridge_exports: $simd_exports"
    echo "OK: --variant all complete"
    ;;
esac
