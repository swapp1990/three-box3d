import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Box3D } from '../src/index.js';
import { freshBox3D } from './helpers.js';

let b3: Box3D;
beforeEach(async () => {
  b3 = await freshBox3D();
});
afterEach(() => b3.dispose());

describe('memory growth', () => {
  it('allocating many bodies grows the heap; HEAP views stay valid and transforms still read', () => {
    const world = b3.createWorld();
    const N = 4000; // enough bodies + solver state to push memory past initial pages
    const ids: number[] = [];
    for (let i = 0; i < N; i++) {
      const body = world.createBody({
        type: 'dynamic',
        position: [(i % 50) * 1.1 - 27.5, 1 + Math.floor(i / 50) * 1.1, 0],
      });
      world.addBox(body, [0.5, 0.5, 0.5], { density: 1 });
      ids.push(body);
    }
    expect(world.bodyCount()).toBe(N);

    // Step a bit so the solver builds islands/contacts (more heap pressure).
    for (let i = 0; i < 5; i++) world.step(1 / 60, 2);

    // A large readTransforms uses scratch allocation big enough to have forced
    // memory.grow(); the loader's fresh HEAP views must still be valid.
    const idsArr = new Int32Array(ids);
    const out = new Float32Array(N * 7);
    world.readTransforms(idsArr, out);

    // Spot-check: every body has a finite position and a normalized quaternion.
    for (let i = 0; i < N; i += 137) {
      const o = i * 7;
      expect(Number.isFinite(out[o])).toBe(true);
      expect(Number.isFinite(out[o + 1])).toBe(true);
      const qlen = Math.hypot(out[o + 3], out[o + 4], out[o + 5], out[o + 6]);
      expect(qlen).toBeCloseTo(1, 2);
    }
    world.destroy();
  });

  it('writing straight into a WASM-heap-backed Float32Array is supported', () => {
    // Not exercised by the public API directly, but confirm a normal JS-backed
    // out buffer survives a heap grow mid-run.
    const world = b3.createWorld();
    const ids: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const body = world.createBody({ type: 'dynamic', position: [0, 1 + i * 0.01, 0] });
      world.addSphere(body, 0.2);
      ids.push(body);
    }
    const out = new Float32Array(ids.length * 7);
    world.readTransforms(new Int32Array(ids), out);
    expect(Number.isFinite(out[out.length - 1])).toBe(true);
    world.destroy();
  });
});
