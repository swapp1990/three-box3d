import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FixedStepper,
  radialImpulse,
  SleepManager,
  TransformBuffer,
  type Box3D,
} from '../src/index.js';
import { freshBox3D } from './helpers.js';

let b3: Box3D;
beforeEach(async () => {
  b3 = await freshBox3D();
});
afterEach(() => b3.dispose());

describe('helper integration against real wasm (README hero shape)', () => {
  it('brick stack settles asleep, then radialImpulse wakes and scatters it', () => {
    const world = b3.createWorld({ gravity: [0, -9.81, 0] });
    const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
    world.addBox(ground, [50, 0.5, 50], { friction: 0.9 });

    const buffer = new TransformBuffer(64);
    const bricks: number[] = [];
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 4; col++) {
        const body = world.createBody({
          type: 'dynamic',
          position: [col * 1.02 - 1.5, 0.26 + row * 0.52, 0],
        });
        world.addBox(body, [0.5, 0.25, 0.25], { density: 2, friction: 0.8 });
        bricks.push(body);
        buffer.add(body as never);
      }
    }

    const sleep = new SleepManager(world, {
      settleSteps: 2,
      sweepIntervalSec: 2,
      moveThreshold: 0.01,
    });
    sleep.watch(bricks as never[], buffer);

    const stepper = new FixedStepper();
    // Simulate ~6 seconds of frames to let the stack settle + a sweep run.
    for (let frame = 0; frame < 360; frame++) {
      stepper.advance(1 / 60, (dt) => {
        world.step(dt);
        sleep.forceSleepSettled();
        sleep.sweep(stepper.simTime);
      });
      buffer.rebuild();
      buffer.readInto(world);
    }

    const settledAwake = world.awakeBodyCount();
    expect(settledAwake).toBe(0); // island asleep — costs ~0 step time

    // Boom at the base of the stack: radialImpulse must WAKE the sleeping island
    // (native explode is a no-op on sleepers).
    buffer.readInto(world);
    radialImpulse(world, bricks as never[], buffer, {
      center: [0, 0.5, 0],
      radius: 5,
      strength: 8.5,
      upwardBias: 1.1,
    });
    expect(world.awakeBodyCount()).toBeGreaterThan(0);

    // And they actually move.
    const before = new Float32Array(buffer.transforms);
    for (let i = 0; i < 20; i++) {
      stepper.advance(1 / 60, (dt) => world.step(dt));
      buffer.readInto(world);
    }
    let moved = 0;
    for (let i = 0; i < bricks.length; i++) {
      const o = i * 7;
      if (Math.hypot(buffer.transforms[o] - before[o], buffer.transforms[o + 1] - before[o + 1]) > 0.05) {
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    world.destroy();
  });
});
