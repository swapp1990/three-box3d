/**
 * Typed WASM loader for box3d — the modernized rewrite of the old repo's
 * hand-written `box3d.js`.
 *
 * Design notes (each cost real debugging time; treat as invariants):
 *
 *   - MUST supply EVERY env import the WASM declares or `WebAssembly.instantiate`
 *     throws a LinkError. Enumerated from the actual binary (see below), the module
 *     imports exactly: `env.emscripten_get_now`, `env.emscripten_resize_heap`,
 *     `wasi_snapshot_preview1.fd_write`, `wasi_snapshot_preview1.clock_time_get`.
 *     `emscripten_notify_memory_growth` is supplied defensively (a growth-notify
 *     build imports it; this artifact does not) — harmless when unused.
 *
 *   - HEAP getters mint a FRESH typed-array view per access. Under
 *     ALLOW_MEMORY_GROWTH, `memory.grow()` allocates a new backing ArrayBuffer and
 *     detaches every prior view; caching a view would silently read stale/zeroed
 *     memory. Fresh views are cheap and always valid.
 *
 *   - The Emscripten static-ctor entry point on THIS artifact is
 *     `__wasm_call_ctors` (a DECLARE_ASM_MODULE_EXPORTS=0 build), NOT `_initialize`
 *     (which only exists in a STANDALONE_WASM build). We call whichever the module
 *     actually exports.
 *
 * Loading paths, in precedence order: `wasmBinary` > `wasmUrl` > `locateFile` >
 * default (`new URL('../wasm/box3d.wasm', import.meta.url)`). Works in the browser
 * (fetch/instantiateStreaming), a worker, and Node (fs read for Vitest).
 */
import type { Box3DExports, Box3DModule, Ptr } from './raw-module.js';

const PAGE_SIZE = 65536;
const textDecoder = new TextDecoder();

/** Loading strategy for the WASM binary (public shape lives in index.ts). */
export interface WasmLoadOptions {
  wasmUrl?: string | URL;
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string) => string;
}

/** True in Node-like environments (no DOM `window`, has `process.versions.node`). */
function isNode(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null &&
    typeof (globalThis as { window?: unknown }).window === 'undefined'
  );
}

/** Default WASM location relative to this module (the shipped `wasm/box3d.wasm`). */
function defaultWasmUrl(): URL {
  return new URL('../wasm/box3d.wasm', import.meta.url);
}

function toArrayBuffer(bin: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bin instanceof Uint8Array) {
    // Copy out only when the view doesn't span the whole ArrayBuffer (a
    // SharedArrayBuffer or a subarray view → make a plain ArrayBuffer copy).
    if (
      bin.buffer instanceof ArrayBuffer &&
      bin.byteOffset === 0 &&
      bin.byteLength === bin.buffer.byteLength
    ) {
      return bin.buffer;
    }
    return bin.slice().buffer as ArrayBuffer;
  }
  return bin;
}

async function resolveWasmBytes(options: WasmLoadOptions): Promise<ArrayBuffer | Response> {
  if (options.wasmBinary != null) {
    return toArrayBuffer(options.wasmBinary);
  }

  const url =
    options.wasmUrl != null
      ? options.wasmUrl
      : options.locateFile != null
        ? options.locateFile('box3d.wasm')
        : defaultWasmUrl();

  if (isNode()) {
    // Node path: fs read, so Vitest and server-side use work without fetch.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path =
      url instanceof URL
        ? fileURLToPath(url)
        : url.startsWith('file:')
          ? fileURLToPath(url)
          : url;
    const buf = await readFile(path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  // Browser / worker: fetch, prefer streaming instantiate when the server sends
  // the correct content-type.
  const response = await fetch(url instanceof URL ? url.href : url);
  if (!response.ok) {
    throw new Error(
      `box3d-web: failed to fetch WASM from ${String(url)} (HTTP ${response.status}). ` +
        `Check the wasmUrl / locateFile override or your bundler's asset handling.`,
    );
  }
  return response;
}

/**
 * Load and instantiate the box3d WASM module. Rejects (never resolves null) on
 * fetch / instantiate / link failure, with a message naming the likely cause.
 */
export async function loadBox3DModule(options: WasmLoadOptions = {}): Promise<Box3DModule> {
  let memory: WebAssembly.Memory | null = null;

  const view = (): DataView => new DataView((memory as WebAssembly.Memory).buffer);

  const emscripten_resize_heap = (requestedSize: number): number => {
    if (memory == null) return 0;
    const oldPages = memory.buffer.byteLength / PAGE_SIZE;
    const requestedPages = Math.ceil(requestedSize / PAGE_SIZE);
    if (requestedPages <= oldPages) return 1;
    try {
      memory.grow(requestedPages - oldPages);
      return 1;
    } catch {
      return 0;
    }
  };

  const clock_time_get = (_clockId: number, _precision: bigint, timePtr: number): number => {
    if (memory == null) return 1;
    view().setBigUint64(timePtr, BigInt(Date.now()) * 1_000_000n, true);
    return 0;
  };

  const fd_write = (_fd: number, iovs: number, iovsLen: number, nwritten: number): number => {
    if (memory == null) return 1;
    const dv = view();
    const heap = new Uint8Array(memory.buffer);
    let written = 0;
    let text = '';
    for (let i = 0; i < iovsLen; ++i) {
      const ptr = dv.getUint32(iovs + i * 8, true);
      const len = dv.getUint32(iovs + i * 8 + 4, true);
      written += len;
      text += textDecoder.decode(heap.subarray(ptr, ptr + len));
    }
    if (text.trim()) console.log(text.trimEnd());
    dv.setUint32(nwritten, written, true);
    return 0;
  };

  const imports: WebAssembly.Imports = {
    env: {
      emscripten_get_now: () =>
        typeof performance !== 'undefined' ? performance.now() : Date.now(),
      emscripten_resize_heap,
      // Supplied defensively: a growth-notify build imports this; if absent it's
      // simply never called. Its presence prevents a LinkError on such builds.
      emscripten_notify_memory_growth: () => {},
    },
    wasi_snapshot_preview1: {
      clock_time_get,
      fd_write,
    },
  };

  let source: ArrayBuffer | Response;
  try {
    source = await resolveWasmBytes(options);
  } catch (err) {
    throw new Error(
      `box3d-web: could not load the WASM binary. ${(err as Error).message}`,
      { cause: err },
    );
  }

  let instance: WebAssembly.Instance;
  try {
    if (source instanceof Response) {
      const contentType = source.headers.get('content-type');
      if (WebAssembly.instantiateStreaming && contentType === 'application/wasm') {
        ({ instance } = await WebAssembly.instantiateStreaming(source, imports));
      } else {
        const bytes = await source.arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(bytes, imports));
      }
    } else {
      ({ instance } = await WebAssembly.instantiate(source, imports));
    }
  } catch (err) {
    throw new Error(
      `box3d-web: WASM instantiation/link failed. This usually means a missing env ` +
        `import or a wrong content-type. Underlying error: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const rawExports = instance.exports as unknown as Box3DExports & Record<string, unknown>;
  memory = rawExports.memory;
  if (memory == null || !(memory instanceof WebAssembly.Memory)) {
    throw new Error('box3d-web: WASM module did not export `memory`.');
  }

  // Run static ctors. This artifact exports `__wasm_call_ctors`; a STANDALONE_WASM
  // build would export `_initialize` instead. Call whichever exists.
  if (typeof rawExports.__wasm_call_ctors === 'function') {
    rawExports.__wasm_call_ctors();
  } else if (typeof rawExports._initialize === 'function') {
    rawExports._initialize();
  } else {
    throw new Error(
      'box3d-web: WASM exports neither `__wasm_call_ctors` nor `_initialize`; ' +
        'cannot run static initializers.',
    );
  }

  const mem = memory;
  const module: Box3DModule = {
    exports: rawExports,
    memory: mem,
    malloc: (size: number): Ptr => rawExports.malloc(size),
    free: (ptr: Ptr): void => rawExports.free(ptr),
    get HEAP8() {
      return new Int8Array(mem.buffer);
    },
    get HEAPU8() {
      return new Uint8Array(mem.buffer);
    },
    get HEAP32() {
      return new Int32Array(mem.buffer);
    },
    get HEAPU32() {
      return new Uint32Array(mem.buffer);
    },
    get HEAPF32() {
      return new Float32Array(mem.buffer);
    },
  };

  return module;
}
