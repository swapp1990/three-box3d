Emscripten build of box3d (bridge.c + pinned box3d source) producing box3d.wasm — see docs/plan.md Phase 0.

## Layout

- `BOX3D_VERSION` — pinned upstream commit/tag + provenance notes.
- `bridge.c` — hand-written C ABI shim over the box3d API (31 `b3bridge_*` exports).
- `expected-exports.txt` — ground-truth export manifest, derived from `bridge.c`;
  `build-wasm.sh` builds `-s EXPORTED_FUNCTIONS` from this file and verifies the
  built wasm's actual exports against it.
- `box3d/` — gitignored. The pinned box3d source, fetched fresh by
  `scripts/fetch-box3d.sh` (never committed).
- `scripts/fetch-box3d.sh` — clones box3d at the exact pinned commit into `box3d/`.
- `scripts/build-wasm.sh` — compiles `box3d/src/**` + `bridge.c` with Emscripten
  into `dist/box3d.wasm` (+ `dist/box3d.js`, an emcc glue side-effect not consumed
  by this project's own hand-written runtime loader), then verifies the export
  list and prints the wasm's SHA256/size.
- `dist/` — committed build output (`box3d.wasm`, `box3d.js`). This repo
  intentionally commits the prebuilt WASM rather than building it on every
  install, matching the old app's policy.

## Building from scratch

```bash
./native/scripts/fetch-box3d.sh
EMSDK_DIR=/path/to/emsdk ./native/scripts/build-wasm.sh
```

`EMSDK_DIR` must point at an emsdk checkout with Emscripten activated (pinned
version 6.0.2 for this build; see `BOX3D_VERSION` for the exact box3d commit).
On Windows, the script calls `emcc.exe` directly (there is no working `emcc.bat`)
and honors `EMCC_TEMP_DIR` for scratch files.
