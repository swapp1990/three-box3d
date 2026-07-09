import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Box3D, World } from '../src/index.js';
import { freshBox3D } from './helpers.js';

let b3: Box3D;
beforeEach(async () => {
  b3 = await freshBox3D();
});
afterEach(() => b3.dispose());

/** Drop a ball onto the ground and step until at least one contact accumulates. */
function contactScene(instance: Box3D = b3): { world: World } {
  const world = instance.createWorld({ gravity: [0, -20, 0] });
  const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
  world.addBox(ground, [10, 0.5, 10], { friction: 0.5, restitution: 0.2 });
  const ball = world.createBody({ type: 'dynamic', position: [0, 1.2, 0], ccd: true });
  world.addSphere(ball, 0.5, { density: 3, restitution: 0.3 });
  return { world };
}

function stepUntilContact(world: World, maxSteps = 240): number {
  for (let i = 0; i < maxSteps; i++) {
    world.step(1 / 60, 4);
    // peek without draining: accumulate happens inside step; we check by draining
    // into a probe and, if empty, keep going. But draining empties — so instead
    // step a fixed number and rely on accumulation-until-drained.
  }
  return maxSteps;
}

describe('event draining contract', () => {
  it('contact-begin events accumulate until drained', () => {
    const { world } = contactScene();
    stepUntilContact(world);
    const events = world.drainContactBeginEvents();
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(typeof e.bodyA).toBe('number');
      expect(typeof e.bodyB).toBe('number');
      expect(typeof e.approachSpeed).toBe('number');
      expect(e.approachSpeed).toBeGreaterThanOrEqual(0);
    }
    world.destroy();
  });

  it('second drain in the same frame returns only newly accumulated (empty)', () => {
    const { world } = contactScene();
    stepUntilContact(world);
    const first = world.drainContactBeginEvents();
    expect(first.length).toBeGreaterThan(0);
    const second = world.drainContactBeginEvents();
    expect(second.length).toBe(0); // no step ran in between
    world.destroy();
  });

  it('drainContactBeginEventsInto matches the object-returning drain', async () => {
    // Two INDEPENDENT instances (isolated WASM memory + body-slot numbering), each
    // built and stepped identically, so the object drain of one and the drainInto
    // of the other read the same deterministic event set. (Two worlds in one
    // module would coexist and perturb each other's handle numbering.)
    const b3a = await freshBox3D();
    const sceneA = contactScene(b3a);
    stepUntilContact(sceneA.world);
    const objEvents = sceneA.world.drainContactBeginEvents();
    expect(objEvents.length).toBeGreaterThan(0);

    const b3b = await freshBox3D();
    const sceneB = contactScene(b3b);
    stepUntilContact(sceneB.world);
    const buf = new Float32Array(objEvents.length * 3);
    const total = sceneB.world.drainContactBeginEventsInto(buf);
    expect(total).toBe(objEvents.length);
    for (let i = 0; i < objEvents.length; i++) {
      expect(buf[i * 3]).toBe(objEvents[i].bodyA);
      expect(buf[i * 3 + 1]).toBe(objEvents[i].bodyB);
      expect(buf[i * 3 + 2]).toBeCloseTo(objEvents[i].approachSpeed, 4);
    }
    b3a.dispose();
    b3b.dispose();
  });

  it('drainInto returns total count even when the buffer is too small', () => {
    const { world } = contactScene();
    stepUntilContact(world);
    const tiny = new Float32Array(3); // room for 1 tuple only
    const total = world.drainContactBeginEventsInto(tiny);
    expect(total).toBeGreaterThan(0);
    // Queue was drained regardless of buffer size.
    expect(world.drainContactBeginEvents().length).toBe(0);
    world.destroy();
  });

  // NOTE ON SENSOR EVENTS: box3d only emits a sensor-begin event when the
  // VISITOR shape also has `enableSensorEvents = true` (native src/sensor.c:118
  // — `if (otherShape->enableSensorEvents == false) ...skip`). The frozen Phase 0
  // bridge (native/bridge.c, `Bridge_MakeShapeDef`) does NOT set that flag on
  // solid box/sphere/capsule shapes, so a dynamic body falling through a sensor
  // never generates an event through the current export surface. These tests
  // therefore verify the sensor drain PLUMBING (queue drain + drainInto parity)
  // rather than a real overlap. Enabling real sensor visitors is a bridge change,
  // deferred to a future recompile.
  it('sensor drain returns an empty array when nothing accumulated', () => {
    const world = b3.createWorld({ gravity: [0, -20, 0] });
    const sensorBody = world.createBody({ type: 'static', position: [0, 0.5, 0] });
    world.addSensorBox(sensorBody, [1, 1, 1]);
    const faller = world.createBody({ type: 'dynamic', position: [0, 4, 0] });
    world.addSphere(faller, 0.3, { density: 2 });
    for (let i = 0; i < 60; i++) world.step(1 / 60, 4);
    // No visitor sensor opt-in on the bridge → no events; drain is well-behaved.
    expect(world.drainSensorEvents()).toEqual([]);
    world.destroy();
  });

  it('drainSensorEventsInto and drainSensorEvents agree on an empty queue', () => {
    const world = b3.createWorld({ gravity: [0, -20, 0] });
    const buf = new Int32Array(16);
    expect(world.drainSensorEventsInto(buf)).toBe(0);
    expect(world.drainSensorEvents()).toEqual([]);
    world.destroy();
  });
});
