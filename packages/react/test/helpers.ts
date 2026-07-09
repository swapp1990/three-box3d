/**
 * Shared test helpers. Real WASM — the box3d-web module is loaded from its shipped
 * .wasm, nothing about core is mocked. The wasm lives in the sibling core package.
 *
 * We load the wasm as `wasmBinary` (bytes) rather than `wasmUrl`, because the test
 * environment is jsdom where `fetch('file://…')` fails (ECONNREFUSED). Passing the
 * bytes directly bypasses fetch entirely — the same path a Node/offline consumer
 * uses.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearBox3DCache, type Box3DLoadOptions } from '../src/index.js';

// vitest runs with cwd = the package dir; the wasm ships from the sibling core
// package. (import.meta.url is an http URL under the jsdom transform, so a
// path relative to cwd is the reliable resolver here.)
const WASM_PATH = resolve(process.cwd(), '../core/wasm/box3d.wasm');

const wasmBytes: Uint8Array = (() => {
  const buf = readFileSync(WASM_PATH);
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
})();

/** Load options that hand the real wasm bytes to the loader (no fetch). Each call
 *  returns a fresh copy so the buffer can't be detached by a prior instantiate. */
export function loadOptions(): Box3DLoadOptions {
  return { wasmBinary: wasmBytes.slice() };
}

/** Reset the module cache between tests so cross-test state can't leak. */
export function resetModuleCache(): void {
  clearBox3DCache();
}
