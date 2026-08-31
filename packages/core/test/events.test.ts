import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { probeCapabilities, type Box3D, type ShapeIdentity, type World } from '../src/index.js';
import { freshBox3D } from './helpers.js';

let b3: Box3D;
beforeEach(async () => {
  b3 = await freshBox3D();
});
afterEach(() => b3.dispose());

/** Drop a ball onto the ground and step until at least one contact accumulates. */
function contactScene(instance: Box3D = b3): {
  world: World;
  groundShape: ReturnType<World['addBox']>;
  ballShape: ReturnType<World['addSphere']>;
} {
  const world = instance.createWorld({ gravity: [0, -20, 0] });
  const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
  const groundShape = world.addBox(ground, [10, 0.5, 10], { friction: 0.5, restitution: 0.2 });
  const ball = world.createBody({ type: 'dynamic', position: [0, 1.2, 0], ccd: true });
  const ballShape = world.addSphere(ball, 0.5, { density: 3, restitution: 0.3 });
  return { world, groundShape, ballShape };
}

/** A zero-gravity overlap scene. Both bodies start at rest, so the begin
 * event's approach speed is exactly zero while shape/body IDs remain useful
 * for cross-instance tuple parity. */
function overlapScene(instance: Box3D): {
  world: World;
  ground: ReturnType<World['createBody']>;
  groundShape: ReturnType<World['addBox']>;
  mover: ReturnType<World['createBody']>;
  moverShape: ReturnType<World['addBox']>;
} {
  const world = instance.createWorld({ gravity: [0, 0, 0], enableSleep: false });
  const ground = world.createBody({ type: 'static', position: [0, 0, 0] });
  const groundShape = world.addBox(ground, [1, 1, 1]);
  const mover = world.createBody({ type: 'dynamic', position: [0.5, 0, 0] });
  const moverShape = world.addBox(mover, [1, 1, 1], { density: 1 });
  return { world, ground, groundShape, mover, moverShape };
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

function sameIdentity(a: ShapeIdentity, b: ShapeIdentity): boolean {
  return a.index1 === b.index1 && a.world0 === b.world0 && a.generation === b.generation;
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
    // built and stepped identically. The controlled overlap keeps both bodies at
    // rest, making the complete three-field tuple deterministic across instances.
    const b3a = await freshBox3D();
    const sceneA = overlapScene(b3a);
    sceneA.world.step(1 / 60, 4);
    const objEvents = sceneA.world.drainContactBeginEvents();
    expect(objEvents).toHaveLength(1);
    expect(objEvents[0].approachSpeed).toBe(0);

    const b3b = await freshBox3D();
    const sceneB = overlapScene(b3b);
    sceneB.world.step(1 / 60, 4);
    const buf = new Float32Array(objEvents.length * 3);
    const total = sceneB.world.drainContactBeginEventsInto(buf);
    expect(total).toBe(objEvents.length);
    for (let i = 0; i < objEvents.length; i++) {
      expect(buf[i * 3]).toBe(objEvents[i].bodyA);
      expect(buf[i * 3 + 1]).toBe(objEvents[i].bodyB);
      expect(buf[i * 3 + 2]).toBe(objEvents[i].approachSpeed);
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

  it('shape-aware APIs are explicit about old WASM builds', () => {
    const world = b3.createWorld();
    if (probeCapabilities(world).contactShapeIdentity) {
      world.destroy();
      return;
    }
    const body = world.createBody();
    const shape = world.addBox(body, [0.5, 0.5, 0.5]);
    expect(() => world.getShapeIdentity(shape)).toThrow(/contactShapeIdentity/);
    expect(() => world.drainContactBeginEventsWithShapes()).toThrow(/contactShapeIdentity/);
    world.destroy();
  });

  it('the bundled WASM exposes shape identity capability', () => {
    const world = b3.createWorld();
    expect(probeCapabilities(world).contactShapeIdentity).toBe(true);
    world.destroy();
  });

  it('shape identity queries distinguish shapes and match detailed begin participants', () => {
    const world = b3.createWorld({ gravity: [0, -20, 0] });
    expect(probeCapabilities(world).contactShapeIdentity).toBe(true);
    const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
    const groundShapeA = world.addBox(ground, [2, 0.5, 2]);
    const groundShapeB = world.addBox(ground, [0.25, 0.25, 0.25], { density: 0 });
    const ball = world.createBody({ type: 'dynamic', position: [0, 2, 0] });
    const ballShape = world.addSphere(ball, 0.5, { density: 2 });
    const identityA = world.getShapeIdentity(groundShapeA);
    const identityB = world.getShapeIdentity(groundShapeB);
    const identityBall = world.getShapeIdentity(ballShape);
    expect(identityA).not.toBeNull();
    expect(identityB).not.toBeNull();
    expect(identityBall).not.toBeNull();
    expect(sameIdentity(identityA!, identityB!)).toBe(false);
    expect(sameIdentity(identityA!, identityBall!)).toBe(false);

    stepUntilContact(world);
    const events = world.drainContactBeginEventsWithShapes();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const participants = [event.shapeA, event.shapeB];
      expect(participants.some((id) => sameIdentity(id, identityA!))).toBe(true);
      expect(participants.some((id) => sameIdentity(id, identityBall!))).toBe(true);
    }
    world.destroy();
  });

  it('destroyed shape queries return null and recreation changes native generation', () => {
    const world = b3.createWorld();
    expect(probeCapabilities(world).contactShapeIdentity).toBe(true);
    const bodyA = world.createBody();
    const shapeA = world.addBox(bodyA, [0.5, 0.5, 0.5]);
    const identityA = world.getShapeIdentity(shapeA);
    expect(identityA).not.toBeNull();
    world.destroyBody(bodyA);
    expect(world.getShapeIdentity(shapeA)).toBeNull();

    const bodyB = world.createBody();
    const shapeB = world.addBox(bodyB, [0.5, 0.5, 0.5]);
    const identityB = world.getShapeIdentity(shapeB);
    expect(identityB).not.toBeNull();
    expect(sameIdentity(identityA!, identityB!)).toBe(false);
    world.destroy();
  });

  it('shape-aware hit events preserve participants and match detailed Into tuples', async () => {
    const b3a = await freshBox3D();
    const sceneA = contactScene(b3a);
    expect(probeCapabilities(sceneA.world).contactShapeIdentity).toBe(true);
    const groundShapeA = sceneA.groundShape;
    const ballShapeA = sceneA.ballShape;
    const groundIdentityA = sceneA.world.getShapeIdentity(groundShapeA);
    const ballIdentityA = sceneA.world.getShapeIdentity(ballShapeA);
    expect(groundIdentityA).not.toBeNull();
    expect(ballIdentityA).not.toBeNull();
    let objectEvents: ReturnType<World['drainContactHitEventsWithShapes']> = [];
    // Drain on the first impact step so the test is independent of the
    // contact-cache state after the solver has settled the ball.
    for (let i = 0; i < 120 && objectEvents.length === 0; i++) {
      sceneA.world.step(1 / 60, 4);
      const hits = sceneA.world.drainContactHitEventsWithShapes();
      objectEvents = hits;
    }
    expect(objectEvents.length).toBeGreaterThan(0);
    const first = objectEvents[0];
    const participants = [first.shapeA, first.shapeB];
    expect(participants.some((id) => sameIdentity(id, groundIdentityA!))).toBe(true);
    expect(participants.some((id) => sameIdentity(id, ballIdentityA!))).toBe(true);
    expect(Number.isFinite(first.point.x)).toBe(true);
    expect(Number.isFinite(first.point.y)).toBe(true);
    expect(Number.isFinite(first.point.z)).toBe(true);
    expect(Number.isFinite(first.normal.x)).toBe(true);
    expect(Number.isFinite(first.normal.y)).toBe(true);
    expect(Number.isFinite(first.normal.z)).toBe(true);
    expect(first.approachSpeed).toBeGreaterThanOrEqual(0);
    sceneA.world.destroy();
    b3a.dispose();

    const b3b = await freshBox3D();
    const sceneB = contactScene(b3b);
    let intoEvents = 0;
    let into = new Float32Array(0);
    for (let i = 0; i < 120 && intoEvents === 0; i++) {
      sceneB.world.step(1 / 60, 4);
      into = new Float32Array(15 * objectEvents.length);
      intoEvents = sceneB.world.drainContactHitEventsWithShapesInto(into);
    }
    expect(intoEvents).toBe(objectEvents.length);
    expect(intoEvents).toBeGreaterThan(0);
    for (let i = 0; i < objectEvents.length; i++) {
      const event = objectEvents[i];
      const o = i * 15;
      expect(into[o]).toBe(event.bodyA);
      expect(into[o + 1]).toBe(event.bodyB);
      expect(into[o + 2]).toBe(event.shapeA.index1);
      expect(into[o + 3]).toBe(event.shapeA.world0);
      expect(into[o + 4]).toBe(event.shapeA.generation);
      expect(into[o + 5]).toBe(event.shapeB.index1);
      expect(into[o + 6]).toBe(event.shapeB.world0);
      expect(into[o + 7]).toBe(event.shapeB.generation);
      for (let j = 8; j < 15; j++) expect(Number.isFinite(into[o + j])).toBe(true);
      expect(into[o + 14]).toBeGreaterThanOrEqual(0);
    }
    sceneB.world.destroy();
    b3b.dispose();
  });

  it('shape-aware end events retain raw identities after a participant is destroyed', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0], enableSleep: false });
    expect(probeCapabilities(world).contactShapeIdentity).toBe(true);
    const ground = world.createBody({ type: 'static', position: [0, 0, 0] });
    const groundShape = world.addBox(ground, [1, 1, 1]);
    const mover = world.createBody({ type: 'dynamic', position: [0.5, 0, 0] });
    const moverShape = world.addBox(mover, [1, 1, 1], { density: 1 });
    const expectedGround = world.getShapeIdentity(groundShape);
    const expectedMover = world.getShapeIdentity(moverShape);
    expect(expectedGround).not.toBeNull();
    expect(expectedMover).not.toBeNull();
    world.step(1 / 60, 4);
    world.drainContactBeginEventsWithShapes();
    world.drainContactHitEventsWithShapes();
    // Destroying the dynamic participant invalidates its native shape before
    // the next drain. The additive bridge must still emit that event's raw
    // generation-safe shape ID, while preserving the legacy body=0 mapping.
    world.destroyBody(mover);
    world.step(1 / 60, 4);
    const ends = world.drainContactEndEventsWithShapes();
    expect(ends.length).toBeGreaterThan(0);
    const ended = ends.find((event) =>
      (sameIdentity(event.shapeA, expectedGround!) && sameIdentity(event.shapeB, expectedMover!)) ||
      (sameIdentity(event.shapeA, expectedMover!) && sameIdentity(event.shapeB, expectedGround!)),
    );
    expect(ended).toBeDefined();
    const destroyedBody = sameIdentity(ended!.shapeA, expectedMover!)
      ? ended!.bodyA
      : ended!.bodyB;
    const liveBody = sameIdentity(ended!.shapeA, expectedGround!)
      ? ended!.bodyA
      : ended!.bodyB;
    expect(destroyedBody).toBe(0);
    expect(liveBody).toBe(ground);
    world.destroy();
  });

  it('detailed object and Into drains agree, and either projection consumes one queue', async () => {
    const b3a = await freshBox3D();
    const sceneA = overlapScene(b3a);
    expect(probeCapabilities(sceneA.world).contactShapeIdentity).toBe(true);
    sceneA.world.step(1 / 60, 4);
    const objectEvents = sceneA.world.drainContactBeginEventsWithShapes();
    expect(objectEvents).toHaveLength(1);
    expect(objectEvents[0].approachSpeed).toBe(0);
    expect(sceneA.world.drainContactBeginEvents()).toEqual([]);
    sceneA.world.destroy();
    b3a.dispose();

    const b3b = await freshBox3D();
    const sceneB = overlapScene(b3b);
    sceneB.world.step(1 / 60, 4);
    const out = new Float32Array(objectEvents.length * 9);
    const total = sceneB.world.drainContactBeginEventsWithShapesInto(out);
    expect(total).toBe(objectEvents.length);
    for (let i = 0; i < objectEvents.length; i++) {
      const event = objectEvents[i];
      const o = i * 9;
      expect(out[o]).toBe(event.bodyA);
      expect(out[o + 1]).toBe(event.bodyB);
      expect(out[o + 2]).toBe(event.shapeA.index1);
      expect(out[o + 3]).toBe(event.shapeA.world0);
      expect(out[o + 4]).toBe(event.shapeA.generation);
      expect(out[o + 5]).toBe(event.shapeB.index1);
      expect(out[o + 6]).toBe(event.shapeB.world0);
      expect(out[o + 7]).toBe(event.shapeB.generation);
      expect(out[o + 8]).toBe(event.approachSpeed);
    }
    expect(sceneB.world.drainContactBeginEvents()).toEqual([]);
    sceneB.world.destroy();
    b3b.dispose();
  });

  // SENSOR EVENTS: box3d only emits a sensor-begin event when the VISITOR shape
  // also has `enableSensorEvents = true` (native src/sensor.c:118 —
  // `if (otherShape->enableSensorEvents == false) ...skip`). Bridge round 2's
  // `Bridge_MakeShapeDef` now defaults `enableSensorEvents = true` on every
  // regular (non-sensor) shape, so a solid dynamic body falling through a
  // sensor box generates a real begin-touch event through the bridge.
  it('a solid body falling through a sensor generates a sensor-begin event', () => {
    const world = b3.createWorld({ gravity: [0, -20, 0] });
    const sensorBody = world.createBody({ type: 'static', position: [0, 0.5, 0] });
    const sensorShape = world.addSensorBox(sensorBody, [1, 1, 1]);
    const faller = world.createBody({ type: 'dynamic', position: [0, 4, 0] });
    world.addSphere(faller, 0.3, { density: 2 });

    let events: ReturnType<typeof world.drainSensorEvents> = [];
    for (let i = 0; i < 120 && events.length === 0; i++) {
      world.step(1 / 60, 4);
      events = world.drainSensorEvents();
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].sensor).toBe(sensorBody);
    expect(events[0].other).toBe(faller);
    void sensorShape;
    world.destroy();
  });

  it('sensor drain returns an empty array when nothing accumulated', () => {
    const world = b3.createWorld({ gravity: [0, -20, 0] });
    const sensorBody = world.createBody({ type: 'static', position: [0, 0.5, 0] });
    world.addSensorBox(sensorBody, [1, 1, 1]);
    // Far away — never overlaps the sensor, so the queue should stay empty.
    const faller = world.createBody({ type: 'dynamic', position: [500, 4, 0] });
    world.addSphere(faller, 0.3, { density: 2 });
    for (let i = 0; i < 60; i++) world.step(1 / 60, 4);
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
