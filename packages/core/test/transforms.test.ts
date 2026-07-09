import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Box3D } from '../src/index.js';
import { freshBox3D } from './helpers.js';

let b3: Box3D;
beforeEach(async () => {
  b3 = await freshBox3D();
});
afterEach(() => b3.dispose());

describe('bulk transform read', () => {
  it('7-float [x,y,z,qx,qy,qz,qw] layout roundtrips exactly', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic', position: [1, 2, 3] });
    world.addBox(body, [0.5, 0.5, 0.5]);
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([body]), out);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(2, 5);
    expect(out[2]).toBeCloseTo(3, 5);
    // identity quaternion (x,y,z,w)
    expect(out[3]).toBeCloseTo(0, 5);
    expect(out[4]).toBeCloseTo(0, 5);
    expect(out[5]).toBeCloseTo(0, 5);
    expect(out[6]).toBeCloseTo(1, 5);
    world.destroy();
  });

  it('rotation quaternion order matches (x,y,z,w) input', () => {
    const world = b3.createWorld();
    // 90° about Y = (0, sin45, 0, cos45)
    const s = Math.SQRT1_2;
    const body = world.createBody({ type: 'static', rotation: [0, s, 0, s] });
    world.addBox(body, [0.5, 0.5, 0.5]);
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([body]), out);
    expect(out[4]).toBeCloseTo(s, 4);
    expect(out[6]).toBeCloseTo(s, 4);
    world.destroy();
  });

  it('invalid/destroyed body reads as [NaN,NaN,NaN, 0,0,0,1]', () => {
    const world = b3.createWorld();
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([999999]), out);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(0);
    expect(out[6]).toBe(1);
    world.destroy();
  });

  it('reads multiple bodies packed contiguously', () => {
    const world = b3.createWorld();
    const a = world.createBody({ type: 'static', position: [1, 0, 0] });
    world.addSphere(a, 0.3);
    const bb = world.createBody({ type: 'static', position: [0, 2, 0] });
    world.addSphere(bb, 0.3);
    const out = new Float32Array(14);
    world.readTransforms(new Int32Array([a, bb]), out);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[7 + 1]).toBeCloseTo(2, 5);
    world.destroy();
  });
});
