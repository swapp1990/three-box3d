import { describe, expect, it } from 'vitest';
import { createBox3D } from '../src/index.js';
import { loadBox3DModule } from '../src/wasm-loader.js';
import { freshBox3D, readWasmBytes } from './helpers.js';

const WASM_URL = new URL('../wasm/box3d.wasm', import.meta.url);
const EXPECTED_BRIDGE_EXPORTS = 50; // matches native/expected-exports.txt (+ malloc/free = 52)

describe('wasm loader', () => {
  it('loads via explicit wasmUrl and runs static ctors', async () => {
    const b3 = await freshBox3D();
    expect(b3.version.box3d).toBe('v0.1.0');
    const world = b3.createWorld();
    expect(typeof world.handle).toBe('number');
    expect(world.handle).toBeGreaterThan(0);
    world.destroy();
    b3.dispose();
  });

  it('loads via wasmBinary (bytes take precedence)', async () => {
    const bytes = await readWasmBytes();
    const b3 = await createBox3D({ wasmBinary: bytes });
    const world = b3.createWorld();
    expect(world.bodyCount()).toBe(0);
    world.destroy();
    b3.dispose();
  });

  it('loads via locateFile resolver', async () => {
    const b3 = await createBox3D({ locateFile: () => WASM_URL.href });
    const world = b3.createWorld();
    expect(world.handle).toBeGreaterThan(0);
    world.destroy();
    b3.dispose();
  });

  it('supplies every env import the module declares (no LinkError)', async () => {
    // If any declared env import were missing, instantiate would throw a
    // LinkError. Enumerate the imports from the binary and assert the loader's
    // instantiation succeeded (it did if we got here).
    const bytes = await readWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    const imports = WebAssembly.Module.imports(compiled);
    // Sanity: the imports we hard-wire must cover every declared import.
    const supplied = new Set([
      'env.emscripten_get_now',
      'env.emscripten_resize_heap',
      'env.emscripten_notify_memory_growth',
      'wasi_snapshot_preview1.clock_time_get',
      'wasi_snapshot_preview1.fd_write',
    ]);
    for (const im of imports) {
      expect(supplied.has(`${im.module}.${im.name}`)).toBe(true);
    }
    // And the loader really instantiates.
    const mod = await loadBox3DModule({ wasmBinary: bytes });
    expect(mod.memory).toBeInstanceOf(WebAssembly.Memory);
    expect(typeof mod.exports.b3bridge_create_world).toBe('function');
  });

  it('exports exactly the expected bridge surface (50 bridge fns)', async () => {
    const bytes = await readWasmBytes();
    const mod = await loadBox3DModule({ wasmBinary: bytes });
    const names = Object.keys(mod.exports as unknown as Record<string, unknown>);
    const bridge = names.filter((n) => n.startsWith('b3bridge_'));
    expect(bridge.length).toBe(EXPECTED_BRIDGE_EXPORTS);
    expect(typeof mod.exports.malloc).toBe('function');
    expect(typeof mod.exports.free).toBe('function');
    // The sports-ball foundation exports are present.
    for (const n of [
      'b3bridge_applyImpulseToCenter',
      'b3bridge_setLinearDamping',
      'b3bridge_getLinearDamping',
      'b3bridge_setAngularDamping',
      'b3bridge_getAngularDamping',
      'b3bridge_setGravityScale',
      'b3bridge_getGravityScale',
      'b3bridge_getBodyMass',
      'b3bridge_getBodyInertia',
      'b3bridge_setBodyInertia',
      // v0.5 joint-motor + filter-joint slice.
      'b3bridge_create_filter_joint',
      'b3bridge_set_revolute_motor',
      'b3bridge_set_spherical_motor',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('HEAP views are fresh per access (memory-growth safe)', async () => {
    const bytes = await readWasmBytes();
    const mod = await loadBox3DModule({ wasmBinary: bytes });
    const a = mod.HEAPF32;
    const b = mod.HEAPF32;
    // Distinct view objects, same backing buffer (until growth).
    expect(a).not.toBe(b);
    expect(a.buffer).toBe(b.buffer);
  });

  it('rejects (does not resolve null) on a bad wasmUrl', async () => {
    await expect(
      createBox3D({ wasmUrl: 'file:///definitely/not/here/box3d.wasm' }),
    ).rejects.toThrow(/box3d-web/);
  });
});
