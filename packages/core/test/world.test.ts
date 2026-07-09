import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Box3D, World } from '../src/index.js';
import { probeCapabilities } from '../src/index.js';
import { buildDropScene, freshBox3D } from './helpers.js';

let b3: Box3D;

beforeEach(async () => {
  b3 = await freshBox3D();
});

afterEach(() => {
  b3.dispose();
});

describe('World lifecycle & bodies', () => {
  it('creates and destroys bodies; counters track', () => {
    const world = b3.createWorld();
    expect(world.bodyCount()).toBe(0);
    const a = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
    world.addSphere(a, 0.5);
    expect(world.bodyCount()).toBe(1);
    world.destroyBody(a);
    expect(world.bodyCount()).toBe(0);
    world.destroy();
  });

  it('shape adders return non-zero ShapeHandles', () => {
    const world = b3.createWorld();
    const body = world.createBody();
    expect(world.addBox(body, [0.5, 0.5, 0.5])).toBeGreaterThan(0);
    const b2 = world.createBody();
    expect(world.addSphere(b2, 0.5)).toBeGreaterThan(0);
    const b3body = world.createBody();
    expect(world.addCapsule(b3body, 0.2, 0.4)).toBeGreaterThan(0);
    const b4 = world.createBody();
    expect(world.addSensorBox(b4, [0.1, 0.1, 0.1])).toBeGreaterThan(0);
    world.destroy();
  });

  it('gravity pulls a dynamic body down', () => {
    const { world, ball } = buildDropScene(b3);
    const ids = new Int32Array([ball]);
    const out = new Float32Array(7);
    world.readTransforms(ids, out);
    const startY = out[1];
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    world.readTransforms(ids, out);
    expect(out[1]).toBeLessThan(startY);
    world.destroy();
  });

  it('setBodyTransform teleports the body', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic' });
    world.addBox(body, [0.5, 0.5, 0.5]);
    world.setBodyTransform(body, [3, 7, -2], [0, 0, 0, 1]);
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([body]), out);
    expect(out[0]).toBeCloseTo(3, 3);
    expect(out[1]).toBeCloseTo(7, 3);
    expect(out[2]).toBeCloseTo(-2, 3);
    world.destroy();
  });

  it('setBodyType flips static/dynamic', () => {
    const { world, ball } = buildDropScene(b3);
    world.setBodyType(ball, 'static');
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([ball]), out);
    const y0 = out[1];
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    world.readTransforms(new Int32Array([ball]), out);
    expect(out[1]).toBeCloseTo(y0, 3); // static → does not fall
    world.destroy();
  });
});

describe('velocities, forces, impulses, kinematics', () => {
  it('set/getLinearVelocity roundtrips (object + Float32Array out)', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
    world.addSphere(body, 0.5);
    world.setLinearVelocity(body, [1.5, -2, 3]);
    const v = world.getLinearVelocity(body);
    expect(v.x).toBeCloseTo(1.5, 3);
    expect(v.y).toBeCloseTo(-2, 3);
    expect(v.z).toBeCloseTo(3, 3);
    const out = new Float32Array(3);
    const same = world.getLinearVelocity(body, out);
    expect(same).toBe(out);
    expect(out[0]).toBeCloseTo(1.5, 3);
    world.destroy();
  });

  it('set/getAngularVelocity roundtrips', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic' });
    world.addBox(body, [0.5, 0.5, 0.5]);
    world.setAngularVelocity(body, [0, 4, 0]);
    const w = world.getAngularVelocity(body);
    expect(w.y).toBeCloseTo(4, 2);
    world.destroy();
  });

  it('applyImpulse changes velocity; wakes body', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
    world.addSphere(body, 0.5, { density: 1 });
    world.applyImpulse(body, [0, 10, 0], [0, 5, 0]);
    const v = world.getLinearVelocity(body);
    expect(v.y).toBeGreaterThan(0);
    world.destroy();
  });

  it('applyForce / applyTorque do not throw and are consumed at step', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
    world.addBox(body, [0.5, 0.5, 0.5]);
    world.applyForce(body, [100, 0, 0]);
    world.applyTorque(body, [0, 5, 0]);
    world.step(1 / 60, 4);
    const v = world.getLinearVelocity(body);
    expect(v.x).toBeGreaterThan(0);
    world.destroy();
  });

  it('setKinematicTarget drives a kinematic body', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'kinematic', position: [0, 0, 0] });
    world.addBox(body, [0.5, 0.5, 0.5]);
    world.setKinematicTarget(body, [1, 0, 0], [0, 0, 0, 1], 1 / 60);
    world.step(1 / 60, 4);
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([body]), out);
    expect(out[0]).toBeGreaterThan(0);
    world.destroy();
  });
});

describe('joints', () => {
  it('creates spherical / revolute / distance joints and destroys them', () => {
    const world = b3.createWorld();
    const anchor = world.createBody({ type: 'static', position: [0, 5, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const hanging = world.createBody({ type: 'dynamic', position: [0, 4, 0] });
    world.addSphere(hanging, 0.3, { density: 5 });

    const sph = world.createSphericalJoint(anchor, hanging, { anchor: [0, 5, 0] });
    expect(sph).toBeGreaterThan(0);
    world.destroyJoint(sph);

    const rev = world.createRevoluteJoint(anchor, hanging, {
      anchor: [0, 5, 0],
      axis: [0, 0, 1],
      limit: [-1, 1],
    });
    expect(rev).toBeGreaterThan(0);
    world.destroyJoint(rev);

    const dist = world.createDistanceJoint(anchor, hanging, {
      length: 1,
      spring: { hertz: 4, dampingRatio: 0.5 },
    });
    expect(dist).toBeGreaterThan(0);
    world.destroyJoint(dist);
    world.destroy();
  });

  it('a spherical joint keeps a body suspended (does not free-fall)', () => {
    const world = b3.createWorld();
    const anchor = world.createBody({ type: 'static', position: [0, 5, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const link = world.createBody({ type: 'dynamic', position: [0, 4, 0] });
    world.addSphere(link, 0.3, { density: 5 });
    world.createSphericalJoint(anchor, link, { anchor: [0, 5, 0] });
    for (let i = 0; i < 120; i++) world.step(1 / 60, 4);
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([link]), out);
    // Suspended ~1m below the anchor — should not have fallen far.
    expect(out[1]).toBeGreaterThan(2);
    world.destroy();
  });
});

describe('queries', () => {
  it('castRayClosest hits a body and returns a readonly point', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(body, [1, 1, 1]);
    const hit = world.castRayClosest([0, 5, 0], [0, -10, 0]);
    expect(hit).not.toBeNull();
    expect(hit!.body).toBe(body);
    expect(hit!.point.y).toBeCloseTo(1, 1);
    world.destroy();
  });

  it('castRayClosest returns null on a miss', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(body, [1, 1, 1]);
    const hit = world.castRayClosest([100, 100, 100], [0, 1, 0]);
    expect(hit).toBeNull();
    world.destroy();
  });
});

describe('sleep control & capabilities', () => {
  it('sleepBody/wakeBody affect the awake count', () => {
    const { world, ball } = buildDropScene(b3);
    world.step(1 / 60, 4);
    world.sleepBody(ball);
    world.step(1 / 60, 4);
    expect(world.awakeBodyCount()).toBe(0);
    world.wakeBody(ball);
    expect(world.awakeBodyCount()).toBeGreaterThan(0);
    world.setAwake(ball, false);
    world.step(1 / 60, 4);
    expect(world.awakeBodyCount()).toBe(0);
    world.destroy();
  });

  it('probeCapabilities reports all optional features present in this build', () => {
    const world = b3.createWorld();
    const caps = probeCapabilities(world);
    expect(caps.explode).toBe(true);
    expect(caps.castRay).toBe(true);
    expect(caps.setBodyType).toBe(true);
    expect(caps.getLinearVelocity).toBe(true);
    expect(caps.forces).toBe(true);
    expect(caps.setBodyTransform).toBe(true);
    expect(caps.angularVelocity).toBe(true);
    expect(caps.has('explode')).toBe(true);
    expect(caps.has('nonexistent-feature')).toBe(false);
    world.destroy();
  });

  it('Box3D.capabilities() matches probeCapabilities()', () => {
    const world = b3.createWorld();
    const a = b3.capabilities();
    const b = probeCapabilities(world);
    expect(a.explode).toBe(b.explode);
    expect(a.forces).toBe(b.forces);
    world.destroy();
  });
});

describe('dispose semantics', () => {
  it('World method after destroy() throws "used after destroy"', () => {
    const world = b3.createWorld();
    world.destroy();
    expect(() => world.step(1 / 60)).toThrow(/destroy/);
    expect(() => world.bodyCount()).toThrow(/destroy/);
  });

  it('Box3D method after dispose() throws', () => {
    const local = b3;
    local.dispose();
    expect(() => local.createWorld()).toThrow(/dispose/);
    // guard afterEach double-dispose:
    b3 = { dispose() {} } as unknown as World & Box3D as unknown as Box3D;
  });

  it('readTransforms validates typed-array kinds and length', () => {
    const world = b3.createWorld();
    const body = world.createBody();
    world.addSphere(body, 0.5);
    // @ts-expect-error wrong array kind
    expect(() => world.readTransforms([body], new Float32Array(7))).toThrow(TypeError);
    expect(() => world.readTransforms(new Int32Array([body]), new Float32Array(3))).toThrow(
      RangeError,
    );
    world.destroy();
  });
});
