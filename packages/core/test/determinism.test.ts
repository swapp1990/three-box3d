import { describe, expect, it } from 'vitest';
import type { Box3D, World } from '../src/index.js';
import { freshBox3D } from './helpers.js';

// Same setup + N steps twice → byte-identical transform streams. This is the
// v0.1 "single-thread, same-build reproducible" guarantee (documented caveat;
// cross-platform CI determinism is deferred to v1.0).

function buildScene(b3: Box3D): { world: World; ids: Int32Array } {
  const world = b3.createWorld({ gravity: [0, -9.81, 0] });
  const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
  world.addBox(ground, [20, 0.5, 20], { friction: 0.8, restitution: 0.1 });

  const ids: number[] = [];
  // A small tumbling stack: 5x5 bricks dropped with a lateral nudge.
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const body = world.createBody({
        type: 'dynamic',
        position: [col * 1.05 - 2.1, 0.5 + row * 0.55, 0],
        rotation: [0, 0, 0, 1],
      });
      world.addBox(body, [0.5, 0.25, 0.25], { density: 2, friction: 0.7, restitution: 0.05 });
      world.setLinearVelocity(body, [0.5, 0, 0.1 * ((idx % 3) - 1)]);
      ids.push(body);
      idx++;
    }
  }
  return { world, ids: new Int32Array(ids) };
}

function runStream(b3: Box3D, steps: number): Float32Array {
  const { world, ids } = buildScene(b3);
  const out = new Float32Array(ids.length * 7);
  const stream = new Float32Array(steps * ids.length * 7);
  for (let s = 0; s < steps; s++) {
    world.step(1 / 60, 4);
    world.readTransforms(ids, out);
    stream.set(out, s * ids.length * 7);
  }
  world.destroy();
  return stream;
}

describe('determinism (single-thread, same-build)', () => {
  it('two identical runs produce byte-identical transform streams', async () => {
    const STEPS = 90;
    // Independent instances so nothing (scratch, memory) leaks between runs.
    const b3a = await freshBox3D();
    const a = runStream(b3a, STEPS);
    b3a.dispose();

    const b3b = await freshBox3D();
    const bstream = runStream(b3b, STEPS);
    b3b.dispose();

    expect(a.length).toBe(bstream.length);
    // Byte-identical: compare the raw bytes, not float-approx.
    const ab = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const bb = new Uint8Array(bstream.buffer, bstream.byteOffset, bstream.byteLength);
    let firstDiff = -1;
    for (let i = 0; i < ab.length; i++) {
      if (ab[i] !== bb[i]) {
        firstDiff = i;
        break;
      }
    }
    expect(firstDiff).toBe(-1);
  });

  it('two runs within the SAME instance are also identical', async () => {
    const STEPS = 60;
    const b3x = await freshBox3D();
    const a = runStream(b3x, STEPS);
    const c = runStream(b3x, STEPS);
    b3x.dispose();
    expect(Array.from(a)).toEqual(Array.from(c));
  });
});
