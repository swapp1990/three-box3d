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
  it('honors full-vector gravity at world creation', () => {
    const world = b3.createWorld({
      gravity: [3, 0, -2],
      enableSleep: false,
      enableContinuous: false,
    });
    const body = world.createBody({ type: 'dynamic' });
    world.addSphere(body, 0.5);
    world.step(1 / 60, 4);
    const velocity = world.getLinearVelocity(body);
    expect(velocity.x).toBeGreaterThan(0);
    expect(Math.abs(velocity.y)).toBeLessThan(1e-5);
    expect(velocity.z).toBeLessThan(0);
    world.destroy();
  });

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

  it('setShapeFriction / setShapeRestitution do not throw on a valid shape (bridge round 2)', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic' });
    const shape = world.addBox(body, [0.5, 0.5, 0.5], { friction: 0.6, restitution: 0 });
    expect(() => world.setShapeFriction(shape, 0.1)).not.toThrow();
    expect(() => world.setShapeRestitution(shape, 0.9)).not.toThrow();
    world.destroy();
  });

  it('supports body damping, gravity scale, rolling resistance, mass, and inertia queries', () => {
    const world = b3.createWorld();
    const body = world.createBody({
      type: 'dynamic',
      linearDamping: 0.1,
      angularDamping: 0.2,
      gravityScale: 0.5,
    });
    world.addSphere(body, 0.5, { density: 3, rollingResistance: 0.25 });

    expect(world.getLinearDamping(body)).toBeCloseTo(0.1);
    expect(world.getAngularDamping(body)).toBeCloseTo(0.2);
    expect(world.getGravityScale(body)).toBeCloseTo(0.5);
    const mass = world.getBodyMass(body);
    expect(mass).toBeCloseTo((4 / 3) * Math.PI * 0.5 ** 3 * 3, 4);

    const expectedInertia = (2 / 5) * mass * 0.5 ** 2;
    const inertia = world.getBodyInertia(body);
    expect(inertia.x).toBeCloseTo(expectedInertia, 5);
    expect(inertia.y).toBeCloseTo(expectedInertia, 5);
    expect(inertia.z).toBeCloseTo(expectedInertia, 5);

    const inertiaOut = new Float32Array(3);
    expect(world.getBodyInertia(body, inertiaOut)).toBe(inertiaOut);
    expect([...inertiaOut]).toEqual([inertia.x, inertia.y, inertia.z]);

    // A hollow thin-shell sphere has I = 2/3*m*r^2 rather than the solid
    // sphere's shape-derived I = 2/5*m*r^2.
    const thinShellInertia = (2 / 3) * mass * 0.5 ** 2;
    world.setBodyInertia(body, [thinShellInertia, thinShellInertia, thinShellInertia]);
    const overriddenInertia = world.getBodyInertia(body);
    expect(overriddenInertia.x).toBeCloseTo(thinShellInertia, 5);
    expect(overriddenInertia.y).toBeCloseTo(thinShellInertia, 5);
    expect(overriddenInertia.z).toBeCloseTo(thinShellInertia, 5);
    expect(world.getBodyMass(body)).toBeCloseTo(mass, 6);

    expect(() => world.setBodyInertia(body, [0, 1, 1])).toThrow(RangeError);
    expect(() => world.setBodyInertia(body, [1, Number.NaN, 1])).toThrow(RangeError);
    expect(world.getBodyInertia(body).x).toBeCloseTo(thinShellInertia, 5);

    world.setLinearDamping(body, 0.4);
    world.setAngularDamping(body, 0.6);
    world.setGravityScale(body, 1.5);
    expect(world.getLinearDamping(body)).toBeCloseTo(0.4);
    expect(world.getAngularDamping(body)).toBeCloseTo(0.6);
    expect(world.getGravityScale(body)).toBeCloseTo(1.5);
    world.destroy();
  });

  it('uses a thin-shell inertia override in angular dynamics', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0], enableSleep: false });
    const solid = world.createBody({ type: 'dynamic' });
    const shell = world.createBody({ type: 'dynamic', position: [2, 0, 0] });
    const radius = 0.5;
    world.addSphere(solid, radius, { density: 3 });
    world.addSphere(shell, radius, { density: 3 });

    const mass = world.getBodyMass(shell);
    const thinShellInertia = (2 / 3) * mass * radius ** 2;
    world.setBodyInertia(shell, [thinShellInertia, thinShellInertia, thinShellInertia]);

    world.applyTorque(solid, [0, 1, 0]);
    world.applyTorque(shell, [0, 1, 0]);
    world.step(1 / 60, 1);

    const solidSpin = world.getAngularVelocity(solid).y;
    const shellSpin = world.getAngularVelocity(shell).y;
    expect(shellSpin).toBeGreaterThan(0);
    expect(shellSpin / solidSpin).toBeCloseTo(3 / 5, 4);
    world.destroy();
  });

  it('setShapeRestitution measurably changes bounce behavior', () => {
    const bouncy = b3.createWorld({ gravity: [0, -20, 0] });
    const ground = bouncy.createBody({ type: 'static', position: [0, -0.5, 0] });
    bouncy.addBox(ground, [10, 0.5, 10], { friction: 0.5, restitution: 0 });
    const ball = bouncy.createBody({ type: 'dynamic', position: [0, 3, 0] });
    const shape = bouncy.addSphere(ball, 0.5, { density: 1, restitution: 0.05 });
    bouncy.setShapeRestitution(shape, 0.95);
    let maxUpwardVelocityAfterFirstBounce = -Infinity;
    let touchedGround = false;
    for (let i = 0; i < 180; i++) {
      bouncy.step(1 / 60, 4);
      const v = bouncy.getLinearVelocity(ball);
      if (v.y < -0.5) touchedGround = true;
      if (touchedGround && v.y > maxUpwardVelocityAfterFirstBounce) {
        maxUpwardVelocityAfterFirstBounce = v.y;
      }
    }
    expect(maxUpwardVelocityAfterFirstBounce).toBeGreaterThan(1);
    bouncy.destroy();
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

  it('setGravity (full vector) changes the direction bodies fall (bridge round 2)', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const body = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addSphere(body, 0.5, { density: 1 });
    world.setGravity([20, 0, 0]);
    for (let i = 0; i < 10; i++) world.step(1 / 60, 4);
    const out = new Float32Array(7);
    world.readTransforms(new Int32Array([body]), out);
    expect(out[0]).toBeGreaterThan(0); // pulled along +X, not -Y
    expect(out[1]).toBeCloseTo(0, 3);
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

  it('getBodyType reports the current type and tracks setBodyType', () => {
    const world = b3.createWorld();
    const body = world.createBody({ type: 'dynamic' });
    world.addBox(body, [0.5, 0.5, 0.5]);
    expect(world.getBodyType(body)).toBe('dynamic');
    world.setBodyType(body, 'static');
    expect(world.getBodyType(body)).toBe('static');
    world.setBodyType(body, 'kinematic');
    expect(world.getBodyType(body)).toBe('kinematic');
    world.destroy();
  });

  it('getBodyType returns null for an invalid handle', () => {
    const world = b3.createWorld();
    expect(world.getBodyType(999999 as unknown as ReturnType<World['createBody']>)).toBeNull();
    world.destroy();
  });

  it('isBodyAwake tracks sleep/wake transitions', () => {
    const { world, ball } = buildDropScene(b3);
    expect(world.isBodyAwake(ball)).toBe(true);
    world.sleepBody(ball);
    world.step(1 / 60, 4);
    expect(world.isBodyAwake(ball)).toBe(false);
    world.wakeBody(ball);
    expect(world.isBodyAwake(ball)).toBe(true);
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

  it('applyImpulseToCenter does not impart torque away from the world origin', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const body = world.createBody({ type: 'dynamic', position: [10, 5, 0] });
    world.addBox(body, [0.5, 0.5, 0.5]);

    world.applyImpulseToCenter(body, [0, 0, 1]);
    expect(world.getLinearVelocity(body).z).toBeGreaterThan(0);
    expect(world.getAngularVelocity(body).y).toBeCloseTo(0, 6);

    world.applyImpulse(body, [0, 0, 1], [10.5, 5, 0]);
    expect(Math.abs(world.getAngularVelocity(body).y)).toBeGreaterThan(0);
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

  it('applyForce at an off-center world point imparts torque (bridge round 2)', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const body = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addBox(body, [0.5, 0.5, 0.5], { density: 1 });
    // Force along +Z applied at a point offset on +X from the center of mass
    // generates torque about Y — angular velocity should pick up.
    world.applyForce(body, [0, 0, 50], [0.5, 0, 0]);
    world.step(1 / 60, 4);
    const w = world.getAngularVelocity(body);
    expect(Math.abs(w.y)).toBeGreaterThan(0);
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

describe('joint motors (v0.5)', () => {
  it('a revolute motor spins a hinged arm toward its target speed', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const arm = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addBox(arm, [0.5, 0.1, 0.1], { density: 1 });
    world.createRevoluteJoint(anchor, arm, {
      axis: [0, 0, 1],
      motor: { speed: 5, maxTorque: 1000 },
    });
    for (let i = 0; i < 180; i++) world.step(1 / 60, 4);
    const w = world.getAngularVelocity(arm);
    // Ample torque budget — the arm should have caught up to the target speed.
    expect(w.z).toBeCloseTo(5, 1);
    expect(Math.abs(w.x)).toBeLessThan(1e-3);
    expect(Math.abs(w.y)).toBeLessThan(1e-3);
    world.destroy();
  });

  it('a revolute motor with a tiny maxTorque cannot reach its target speed (torque clamp)', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const arm = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addBox(arm, [0.5, 0.1, 0.1], { density: 1 });
    world.createRevoluteJoint(anchor, arm, {
      axis: [0, 0, 1],
      motor: { speed: 5, maxTorque: 0.001 },
    });
    for (let i = 0; i < 180; i++) world.step(1 / 60, 4);
    const w = world.getAngularVelocity(arm);
    // Starved of torque — far short of the 5 rad/s target, but still moving
    // (proves the motor is driving, not merely inert).
    expect(w.z).toBeGreaterThan(0);
    expect(w.z).toBeLessThan(2);
    world.destroy();
  });

  it('a revolute joint created without `motor` does not spin (motor disabled = no drive)', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const arm = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addBox(arm, [0.5, 0.1, 0.1], { density: 1 });
    world.createRevoluteJoint(anchor, arm, { axis: [0, 0, 1] });
    for (let i = 0; i < 60; i++) world.step(1 / 60, 4);
    const w = world.getAngularVelocity(arm);
    expect(Math.abs(w.z)).toBeLessThan(1e-4);
    world.destroy();
  });

  it('setRevoluteMotor enables a motor after creation and disables it with null', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const arm = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addBox(arm, [0.5, 0.1, 0.1], { density: 1 });
    const joint = world.createRevoluteJoint(anchor, arm, { axis: [0, 0, 1] });

    // Not created with a motor — starts inert.
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    expect(Math.abs(world.getAngularVelocity(arm).z)).toBeLessThan(1e-4);

    // Enable at runtime; should spin up.
    world.setRevoluteMotor(joint, { speed: 5, maxTorque: 1000 });
    for (let i = 0; i < 180; i++) world.step(1 / 60, 4);
    const spun = world.getAngularVelocity(arm).z;
    expect(spun).toBeCloseTo(5, 1);

    // Disable; angular velocity should stop being driven (no longer growing
    // toward the target — since it's already AT the target, disabling just
    // frees the joint, so we instead check it doesn't overshoot further and
    // coasts rather than being clamped back to the old target).
    world.setRevoluteMotor(joint, null);
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    // Free spin, no damping in this scene — should still be close to `spun`.
    expect(world.getAngularVelocity(arm).z).toBeCloseTo(spun, 0);
    world.destroy();
  });

  it('a spherical motor drives angular velocity toward the target', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const ball = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addSphere(ball, 0.3, { density: 1 });
    world.createSphericalJoint(anchor, ball, {
      motor: { velocity: [0, 5, 0], maxTorque: 1000 },
    });
    for (let i = 0; i < 180; i++) world.step(1 / 60, 4);
    const w = world.getAngularVelocity(ball);
    expect(w.y).toBeCloseTo(5, 0);
    world.destroy();
  });

  it('a spherical joint created without `motor` does not spin', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const ball = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addSphere(ball, 0.3, { density: 1 });
    world.createSphericalJoint(anchor, ball, {});
    for (let i = 0; i < 60; i++) world.step(1 / 60, 4);
    const w = world.getAngularVelocity(ball);
    expect(Math.abs(w.x)).toBeLessThan(1e-4);
    expect(Math.abs(w.y)).toBeLessThan(1e-4);
    expect(Math.abs(w.z)).toBeLessThan(1e-4);
    world.destroy();
  });

  it('setSphericalMotor enables a motor after creation and disables it with null', () => {
    const world = b3.createWorld({ gravity: [0, 0, 0] });
    const anchor = world.createBody({ type: 'static', position: [0, 0, 0] });
    world.addBox(anchor, [0.1, 0.1, 0.1]);
    const ball = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
    world.addSphere(ball, 0.3, { density: 1 });
    const joint = world.createSphericalJoint(anchor, ball, {});

    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    expect(Math.abs(world.getAngularVelocity(ball).y)).toBeLessThan(1e-4);

    world.setSphericalMotor(joint, { velocity: [0, 5, 0], maxTorque: 1000 });
    for (let i = 0; i < 180; i++) world.step(1 / 60, 4);
    expect(world.getAngularVelocity(ball).y).toBeCloseTo(5, 0);

    world.setSphericalMotor(joint, null);
    world.destroy();
  });
});

describe('filter joint (v0.5)', () => {
  it('disables collision between two overlapping dynamic bodies; destroyJoint restores it', () => {
    // Default gravity (not zeroed): both spheres free-fall together, which
    // keeps them awake for the whole test and sidesteps sleep entirely — a
    // resting zero-velocity pair would settle to sleep and never re-collide
    // after the filter is removed, since sleeping islands aren't stepped.
    const world = b3.createWorld();
    const a = world.createBody({ type: 'dynamic', position: [0, 20, 0] });
    world.addSphere(a, 0.5, { density: 1 });
    const b = world.createBody({ type: 'dynamic', position: [0, 20, 0] });
    world.addSphere(b, 0.5, { density: 1 });

    const joint = world.createFilterJoint(a, b);
    expect(joint).toBeGreaterThan(0);

    const out = new Float32Array(14);
    const ids = new Int32Array([a, b]);
    const distanceOf = (): number => {
      world.readTransforms(ids, out);
      const dx = out[7] - out[0];
      const dy = out[8] - out[1];
      const dz = out[9] - out[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    // Fully overlapping, identical mass/shape, filtered — both fall at the
    // same rate with no depenetration impulse, so they stay coincident
    // instead of being pushed apart by the contact solver.
    expect(distanceOf()).toBeLessThan(0.01);

    world.destroyJoint(joint);
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    // Collision restored — the solver now pushes the overlapping spheres apart.
    expect(distanceOf()).toBeGreaterThan(0.5);

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
    // Bridge round 2 additions — all present in this build.
    expect(caps.forceAtPoint).toBe(true);
    expect(caps.bodyQueries).toBe(true);
    expect(caps.setGravity).toBe(true);
    expect(caps.shapeMaterial).toBe(true);
    expect(caps.bodyInertia).toBe(true);
    expect(caps.setBodyInertia).toBe(true);
    expect(caps.has('bodyInertia')).toBe(true);
    expect(caps.has('setBodyInertia')).toBe(true);
    expect(caps.has('shapeMaterial')).toBe(true);
    // v0.5 joint-motor + filter-joint slice — present in this build.
    expect(caps.jointMotors).toBe(true);
    expect(caps.filterJoint).toBe(true);
    expect(caps.has('jointMotors')).toBe(true);
    expect(caps.has('filterJoint')).toBe(true);
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
