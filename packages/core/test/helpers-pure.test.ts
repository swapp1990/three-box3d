import { describe, expect, it, vi } from 'vitest';
import { BodyPool } from '../src/helpers/body-pool.js';
import { FixedStepper } from '../src/helpers/fixed-step.js';
import { radialImpulse } from '../src/helpers/radial-impulse.js';
import { SleepManager } from '../src/helpers/sleep-manager.js';
import { TransformBuffer } from '../src/helpers/transform-buffer.js';
import type { BodyHandle, Vec3 } from '../src/types.js';

const bh = (n: number) => n as BodyHandle;

describe('FixedStepper', () => {
  it('runs the right number of fixed steps and tracks simTime', () => {
    const s = new FixedStepper({ fixedDt: 1 / 60 });
    const seen: number[] = [];
    const n = s.advance(3 / 60 + 0.001, (dt) => seen.push(dt));
    expect(n).toBe(3);
    expect(seen).toEqual([1 / 60, 1 / 60, 1 / 60]);
    expect(s.simTime).toBeCloseTo(3 / 60, 6);
  });

  it('returns 0 steps when delta is below one fixed step', () => {
    const s = new FixedStepper();
    expect(s.advance(0.005, () => {})).toBe(0);
  });

  it('clamps a huge delta and caps steps per frame (death-spiral guard)', () => {
    const s = new FixedStepper({ maxStepsPerFrame: 3, maxDeltaClamp: 0.1, fixedDt: 1 / 60 });
    let count = 0;
    // 10 seconds in one frame: clamp to 0.1s, and never exceed 3 steps.
    const n = s.advance(10, () => count++);
    expect(n).toBe(3);
    expect(count).toBe(3);
  });

  it('reset zeroes simTime and accumulator', () => {
    const s = new FixedStepper();
    s.advance(0.5, () => {});
    s.reset();
    expect(s.simTime).toBe(0);
    expect(s.advance(0.005, () => {})).toBe(0);
  });
});

describe('TransformBuffer', () => {
  it('is insertion-ordered and rebuilds ids', () => {
    const buf = new TransformBuffer(2);
    buf.add(bh(10));
    buf.add(bh(20));
    buf.add(bh(30)); // forces a grow past capacity 2
    expect(Array.from(buf.ids)).toEqual([10, 20, 30]);
    expect(buf.count).toBe(3);
    expect(buf.transforms.length).toBe(21);
  });

  it('offsetOf maps body → current 7-float offset', () => {
    const buf = new TransformBuffer();
    buf.add(bh(10));
    buf.add(bh(20));
    expect(buf.offsetOf(bh(10))).toBe(0);
    expect(buf.offsetOf(bh(20))).toBe(7);
    expect(buf.offsetOf(bh(999))).toBeUndefined();
  });

  it('remove compacts and RENUMBERS later bodies on rebuild', () => {
    const buf = new TransformBuffer();
    buf.add(bh(10));
    buf.add(bh(20));
    buf.add(bh(30));
    buf.remove(bh(10));
    expect(Array.from(buf.ids)).toEqual([20, 30]);
    expect(buf.offsetOf(bh(20))).toBe(0); // renumbered from 7 → 0
    expect(buf.offsetOf(bh(30))).toBe(7);
  });

  it('readInto forwards packed ids to the world', () => {
    const buf = new TransformBuffer();
    buf.add(bh(10));
    buf.add(bh(20));
    const world = {
      readTransforms: vi.fn((ids: Int32Array, out: Float32Array) => {
        for (let i = 0; i < ids.length; i++) out[i * 7] = ids[i]; // stamp x = id
        return out;
      }),
    };
    buf.readInto(world);
    expect(world.readTransforms).toHaveBeenCalledOnce();
    expect(buf.transforms[0]).toBe(10);
    expect(buf.transforms[7]).toBe(20);
  });
});

describe('radialImpulse — exact math (frozen)', () => {
  interface Call {
    body: number;
    impulse: [number, number, number];
    at: [number, number, number];
  }

  function mockWorld() {
    const woken: number[] = [];
    const calls: Call[] = [];
    const world = {
      wakeBody: (b: BodyHandle) => woken.push(b),
      applyImpulse: (b: BodyHandle, i: Vec3, at?: Vec3) =>
        calls.push({
          body: b,
          impulse: [i[0], i[1], i[2]],
          at: at ? [at[0], at[1], at[2]] : [0, 0, 0],
        }),
    };
    return { world, woken, calls };
  }

  function bufferWith(positions: Record<number, [number, number, number]>) {
    const bodies = Object.keys(positions).map(Number);
    const transforms = new Float32Array(bodies.length * 7);
    const offsets = new Map<number, number>();
    bodies.forEach((b, i) => {
      offsets.set(b, i * 7);
      transforms[i * 7] = positions[b][0];
      transforms[i * 7 + 1] = positions[b][1];
      transforms[i * 7 + 2] = positions[b][2];
    });
    return {
      offsetOf: (b: BodyHandle) => offsets.get(b),
      transforms,
    };
  }

  it('reproduces yardPhysics boomAt (strength 0.9, upwardBias 0.28, quadratic)', () => {
    // Body at (1,0,0), center at origin, radius 3.2. Hand-compute:
    const center: Vec3 = [0, 0, 0];
    const radius = 3.2;
    const strength = 0.9;
    const upwardBias = 0.28;
    const bx = 1;
    const d = 1; // distance from origin
    const f = 1 - d / radius;
    const s = strength * f * f;
    const inv = 1 / d;
    const expIx = bx * inv * s; // dx=1
    const expIy = 0 * inv * s + upwardBias * s; // dy=0
    const expIz = 0;

    const { world, woken, calls } = mockWorld();
    const buffer = bufferWith({ 1: [1, 0, 0] });
    radialImpulse(world, [bh(1)], buffer, {
      center,
      radius,
      strength,
      upwardBias,
      falloff: 'quadratic',
    });
    expect(woken).toEqual([1]);
    expect(calls).toHaveLength(1);
    expect(calls[0].impulse[0]).toBeCloseTo(expIx, 6);
    expect(calls[0].impulse[1]).toBeCloseTo(expIy, 6);
    expect(calls[0].impulse[2]).toBeCloseTo(expIz, 6);
    expect(calls[0].at).toEqual([1, 0, 0]);
  });

  it('reproduces playgroundPhysics blastAt (strength 8.5, upwardBias 1.1)', () => {
    // Body at (2,1,0), center (0,0,0), radius 4 (BLAST). Hand-compute.
    const center: Vec3 = [0, 0, 0];
    const radius = 4;
    const strength = 8.5;
    const upwardBias = 1.1;
    const px = 2;
    const py = 1;
    const d = Math.hypot(px, py, 0);
    const f = 1 - d / radius;
    const s = strength * f * f;
    const inv = 1 / d;
    const expIx = px * inv * s;
    const expIy = py * inv * s + upwardBias * s;

    const { world, calls } = mockWorld();
    const buffer = bufferWith({ 7: [2, 1, 0] });
    radialImpulse(world, [bh(7)], buffer, { center, radius, strength, upwardBias });
    expect(calls[0].impulse[0]).toBeCloseTo(expIx, 5);
    expect(calls[0].impulse[1]).toBeCloseTo(expIy, 5);
  });

  it('skips out-of-range bodies and uses zero direction within 1mm of center', () => {
    const { world, calls } = mockWorld();
    const buffer = bufferWith({ 1: [100, 0, 0], 2: [0.0005, 0, 0] });
    radialImpulse(world, [bh(1), bh(2)], buffer, {
      center: [0, 0, 0],
      radius: 3,
      strength: 5,
      upwardBias: 0.5,
    });
    // body 1 out of range → skipped; body 2 in range → radial dir zeroed, only
    // the upward bias term remains.
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toBe(2);
    expect(calls[0].impulse[0]).toBe(0);
    expect(calls[0].impulse[2]).toBe(0);
    expect(calls[0].impulse[1]).toBeGreaterThan(0);
  });

  it("linear falloff uses s = strength * f (not f²)", () => {
    const { world, calls } = mockWorld();
    const radius = 4;
    const strength = 10;
    const d = 2;
    const f = 1 - d / radius; // 0.5
    const buffer = bufferWith({ 1: [d, 0, 0] });
    radialImpulse(world, [bh(1)], buffer, {
      center: [0, 0, 0],
      radius,
      strength,
      falloff: 'linear',
    });
    // s = 10 * 0.5 = 5; dir = +x; impulse.x = 5
    expect(calls[0].impulse[0]).toBeCloseTo(strength * f, 6);
  });
});

describe('SleepManager', () => {
  it('force-sleeps all watched bodies after settleSteps', () => {
    const slept: number[] = [];
    const world = { sleepBody: (b: BodyHandle) => slept.push(b) };
    const buffer = { offsetOf: () => 0, transforms: new Float32Array(21) };
    const mgr = new SleepManager(world, { settleSteps: 2 });
    mgr.watch([bh(1), bh(2), bh(3)], buffer);
    mgr.forceSleepSettled(); // countdown 2 -> 1
    mgr.forceSleepSettled(); // countdown 1 -> 0
    expect(slept).toEqual([]);
    mgr.forceSleepSettled(); // fires
    expect(slept.sort()).toEqual([1, 2, 3]);
    // does not fire again
    slept.length = 0;
    mgr.forceSleepSettled();
    expect(slept).toEqual([]);
  });

  it('sweep sleeps bodies that moved less than the threshold', () => {
    const slept: number[] = [];
    const world = { sleepBody: (b: BodyHandle) => slept.push(b) };
    // body 1 stays put, body 2 keeps moving.
    const transforms = new Float32Array(14);
    const positions = new Map<number, number>([
      [1, 0],
      [2, 7],
    ]);
    const buffer = {
      offsetOf: (b: BodyHandle) => positions.get(b),
      transforms,
    };
    const mgr = new SleepManager(world, { settleSteps: 0, sweepIntervalSec: 2, moveThreshold: 0.01 });
    mgr.watch([bh(1), bh(2)], buffer);

    // t=0: first sweep just samples.
    mgr.sweep(0);
    expect(slept).toEqual([]);

    // move body 2 by 1m, body 1 stays.
    transforms[7] = 1;
    // t=2: interval elapsed → sweep. body1 (unmoved) sleeps, body2 does not.
    mgr.sweep(2);
    expect(slept).toEqual([1]);
  });
});

describe('BodyPool (experimental)', () => {
  it('caps the pool and evicts the oldest', () => {
    const destroyed: number[] = [];
    const evicted: number[] = [];
    let next = 1;
    const world = { destroyBody: (b: BodyHandle) => destroyed.push(b) };
    const pool = new BodyPool(world, { max: 2, onEvict: (b) => evicted.push(b) });
    const spawn = () => pool.spawn(() => bh(next++));
    spawn(); // 1
    spawn(); // 2
    spawn(); // 3 -> evicts 1
    expect(Array.from(pool.bodies)).toEqual([2, 3]);
    expect(destroyed).toEqual([1]);
    expect(evicted).toEqual([1]);
    pool.destroyAll();
    expect(destroyed.sort()).toEqual([1, 2, 3]);
    expect(pool.bodies).toHaveLength(0);
  });
});
