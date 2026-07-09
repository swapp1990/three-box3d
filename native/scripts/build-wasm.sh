#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: native/scripts/build-wasm.sh [--help]

Build the vendored box3d C sources plus native/bridge.c into:
  native/dist/box3d.js
  native/dist/box3d.wasm

Required environment:
  EMSDK_DIR      Path to an emsdk checkout. Example:
                   export EMSDK_DIR=/path/to/emsdk

Optional environment:
  EMCC_TEMP_DIR  Scratch directory for emcc and temporary object files.
                 Defaults to ${TMPDIR:-/tmp}/three-box3d-emcc.

Notes:
  - This script does not vendor or install emsdk. The caller must provide it.
  - The generated box3d.js is emcc glue emitted as a build side-effect. The
    project ships its own hand-written runtime loader elsewhere.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: unknown argument: $1" >&2
  echo >&2
  usage >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/../.." && pwd -P)"
cd "$repo_root"

objs_dir=""
verify_script=""
build_succeeded=0

cleanup() {
  local status=$?

  if [[ "$build_succeeded" == "1" ]]; then
    if [[ -n "$objs_dir" ]]; then
      rm -rf -- "$objs_dir" || true
    fi
    if [[ -n "$verify_script" && -f "$verify_script" ]]; then
      rm -f -- "$verify_script" || true
    fi
  elif [[ "$status" -ne 0 ]]; then
    if [[ -n "$objs_dir" ]]; then
      echo "Build failed; temporary object files were left in: $objs_dir" >&2
    fi
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

objs_dir="$EMCC_TEMP_DIR/objs"
rm -rf -- "$objs_dir"
mkdir -p -- "$objs_dir"

###############################################################################
# Compile
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
objects=()
compile_flags=(
  -I native/box3d/include
  -I native/box3d/src
  -O3
  -DNDEBUG
  -DBOX3D_DISABLE_SIMD
  -ffp-contract=off
)

echo "Compiling ${#sources[@]} C files..."
for source_file in "${sources[@]}"; do
  rel_name="${source_file#native/}"
  obj_name="${rel_name//\//__}.o"
  obj_file="$objs_dir/$obj_name"

  echo "  $source_file -> $obj_file"
  "$emcc" "${compile_flags[@]}" -c "$source_file" -o "$obj_file"
  objects+=("$obj_file")
done

###############################################################################
# Link
###############################################################################

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

echo "Linking native/dist/box3d.js and native/dist/box3d.wasm..."
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
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s DECLARE_ASM_MODULE_EXPORTS=0 \
  -s "EXPORTED_FUNCTIONS=$exported_functions" \
  -o native/dist/box3d.js

###############################################################################
# Verify
###############################################################################

wasm_file="native/dist/box3d.wasm"
if [[ ! -f "$wasm_file" ]]; then
  echo "ERROR: expected output not found: $wasm_file" >&2
  exit 1
fi

wasm_size="$(wc -c < "$wasm_file" | tr -d '[:space:]')"
if command -v sha256sum >/dev/null 2>&1; then
  wasm_sha256="$(sha256sum "$wasm_file" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  wasm_sha256="$(shasum -a 256 "$wasm_file" | awk '{print $1}')"
else
  wasm_sha256="<manual>"
  echo "WARNING: sha256sum and shasum were not found; please compute SHA256 manually for $wasm_file." >&2
fi

echo "WASM SHA256: $wasm_sha256"
echo "WASM bytes: $wasm_size"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required to verify WASM exports." >&2
  exit 1
fi

verify_script="$EMCC_TEMP_DIR/verify-box3d-exports.mjs"
cat > "$verify_script" <<'NODE_EOF'
import fs from 'node:fs/promises';

const [wasmPath, expectedExportsPath] = process.argv.slice(2);

if (!wasmPath || !expectedExportsPath) {
  console.error('Usage: node verify-box3d-exports.mjs <box3d.wasm> <expected-exports.txt>');
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

console.log(String(actualBridgeExports.length));
NODE_EOF

bridge_export_count="$(node "$verify_script" "$wasm_file" "$expected_exports_file")"

build_succeeded=1
echo "OK: wasm_sha256=$wasm_sha256 bytes=$wasm_size b3bridge_exports=$bridge_export_count"
