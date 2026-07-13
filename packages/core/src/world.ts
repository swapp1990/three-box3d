/**
 * `World` — the method-bag view over a WorldHandle. Cheap wrapper; holds no
 * per-body state, but DOES own a small set of reusable WASM scratch buffers and
 * two JS-side event queues (see the draining contract below).
 *
 * Scratch buffers are grow-only and freed on `destroy()`. Never allocate inside a
 * hot path (readTransforms, drain*Into) — reuse the scratch.
 *
 * Draining contract (frozen, docs/api-design.md §2.8): events ACCUMULATE UNTIL
 * DRAINED. box3d only exposes the events from the most recent step and rebuilds
 * them every step, so `step()` pulls the step's contact/sensor begin events out of
 * the bridge and APPENDS them to JS-side queues. A drain returns everything
 * accumulated since the previous drain and empties that queue. The array and
 * `…Into` variants read the SAME queue.
 */
import type { Box3DModule, Ptr } from './raw-module.js';
import {
  BODY_TYPE_TO_INT,
  INT_TO_BODY_TYPE,
  type BodyHandle,
  type BodyOptions,
  type BodyType,
  type ContactBeginEvent,
  type DistanceJointOptions,
  type JointHandle,
  type Quat,
  type RaycastHit,
  type RevoluteJointMotor,
  type RevoluteJointOptions,
  type SensorEvent,
  type ShapeHandle,
  type ShapeMaterial,
  type SphericalJointMotor,
  type SphericalJointOptions,
  type Vec3,
  type Vec3Out,
  type WorldHandle,
  type WorldOptions,
} from './types.js';

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

/** A single grow-only WASM scratch allocation. */
class Scratch {
  ptr: Ptr = 0;
  bytes = 0;
  constructor(private readonly mod: Box3DModule) {}
  ensure(bytes: number): Ptr {
    if (this.bytes < bytes) {
      if (this.ptr) this.mod.free(this.ptr);
      this.ptr = this.mod.malloc(bytes);
      this.bytes = bytes;
    }
    return this.ptr;
  }
  dispose(): void {
    if (this.ptr) this.mod.free(this.ptr);
    this.ptr = 0;
    this.bytes = 0;
  }
}

const EVENT_DRAIN_CAPACITY = 64; // per-step read chunk (bridge retries on overflow)

export class WorldImpl {
  readonly handle: WorldHandle;
  private readonly mod: Box3DModule;
  private disposed = false;

  private readonly idsScratch: Scratch;
  private readonly transformsScratch: Scratch;
  private readonly vectorScratch: Scratch;
  private readonly eventsScratch: Scratch;

  // JS-side accumulate-until-drained queues. Flat for cheap drainInto.
  // contact: [bodyA, bodyB, approachSpeed] triples; sensor: [sensor, other] pairs.
  private contactQueue: number[] = [];
  private sensorQueue: number[] = [];

  constructor(mod: Box3DModule, handle: WorldHandle) {
    this.mod = mod;
    this.handle = handle;
    this.idsScratch = new Scratch(mod);
    this.transformsScratch = new Scratch(mod);
    this.vectorScratch = new Scratch(mod);
    this.eventsScratch = new Scratch(mod);
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new Error('box3d-web: World used after destroy().');
    }
  }

  // --- lifecycle ---

  step(dt: number, substeps = 4): void {
    this.assertLive();
    this.mod.exports.b3bridge_step(this.handle, finiteOr(dt, 1 / 60), substeps | 0);
    this.pullEvents();
  }

  /** Change the world's full gravity vector (x,y,z) at runtime. */
  setGravity(gravity: Vec3): void {
    this.assertLive();
    const [x, y, z] = gravity;
    this.mod.exports.b3bridge_setGravity(this.handle, finiteOr(x, 0), finiteOr(y, -9.81), finiteOr(z, 0));
  }

  /** Read the step's begin events out of the bridge into the JS queues. */
  private pullEvents(): void {
    // Contact begin events: [bodyA, bodyB, approachSpeed] per tuple.
    this.readBridgeEvents(3, 'b3bridge_drain_contact_begin_events', (heap, base, count) => {
      for (let i = 0; i < count; i++) {
        const o = base + i * 3;
        this.contactQueue.push(heap[o] | 0, heap[o + 1] | 0, heap[o + 2]);
      }
    });
    // Sensor begin events: [sensor, other] per tuple.
    this.readBridgeEvents(2, 'b3bridge_drain_sensor_events', (heap, base, count) => {
      for (let i = 0; i < count; i++) {
        const o = base + i * 2;
        this.sensorQueue.push(heap[o] | 0, heap[o + 1] | 0);
      }
    });
  }

  private readBridgeEvents(
    tupleSize: number,
    exportName: 'b3bridge_drain_contact_begin_events' | 'b3bridge_drain_sensor_events',
    consume: (heapF32: Float32Array, base: number, count: number) => void,
  ): void {
    let capacity = EVENT_DRAIN_CAPACITY;
    for (;;) {
      const ptr = this.eventsScratch.ensure(capacity * tupleSize * 4);
      const total = this.mod.exports[exportName](this.handle, ptr, capacity);
      if (total > capacity) {
        // Bridge only wrote `capacity` tuples; re-read with a buffer big enough
        // to capture all of them in one shot (mirrors the old bridge retry).
        capacity = total;
        continue;
      }
      if (total > 0) {
        consume(this.mod.HEAPF32, ptr >> 2, total);
      }
      break;
    }
  }

  createBody(options: BodyOptions = {}): BodyHandle {
    this.assertLive();
    const {
      type = 'dynamic',
      position,
      rotation,
      ccd = false,
      linearDamping = 0,
      angularDamping = 0,
      gravityScale = 1,
    } = options;
    const [x, y, z] = position ?? [0, 0, 0];
    const [qx, qy, qz, qw] = rotation ?? [0, 0, 0, 1];
    const typeInt = BODY_TYPE_TO_INT[type] ?? BODY_TYPE_TO_INT.dynamic;
    return this.mod.exports.b3bridge_create_body(
      this.handle,
      typeInt,
      finiteOr(x, 0),
      finiteOr(y, 0),
      finiteOr(z, 0),
      finiteOr(qx, 0),
      finiteOr(qy, 0),
      finiteOr(qz, 0),
      finiteOr(qw, 1),
      boolInt(ccd),
      Math.max(0, finiteOr(linearDamping, 0)),
      Math.max(0, finiteOr(angularDamping, 0)),
      finiteOr(gravityScale, 1),
    ) as BodyHandle;
  }

  destroyBody(body: BodyHandle): void {
    this.assertLive();
    this.mod.exports.b3bridge_destroy_body(body);
  }

  setBodyType(body: BodyHandle, type: BodyType): void {
    this.assertLive();
    this.mod.exports.b3bridge_set_body_type(body, BODY_TYPE_TO_INT[type] ?? BODY_TYPE_TO_INT.dynamic);
  }

  /** Returns the body's current type, or `null` for an invalid handle or an
   *  older WASM build that predates this export (bridge round 2). */
  getBodyType(body: BodyHandle): BodyType | null {
    this.assertLive();
    const raw = this.mod.exports.b3bridge_getBodyType(body);
    if (raw < 0) return null;
    return INT_TO_BODY_TYPE[raw] ?? null;
  }

  /** Returns whether the body is currently awake (bridge round 2). */
  isBodyAwake(body: BodyHandle): boolean {
    this.assertLive();
    return this.mod.exports.b3bridge_isBodyAwake(body) !== 0;
  }

  setBodyTransform(body: BodyHandle, position: Vec3, rotation: Quat): void {
    this.assertLive();
    const [x, y, z] = position;
    const [qx, qy, qz, qw] = rotation;
    this.mod.exports.b3bridge_setBodyTransform(
      body,
      finiteOr(x, 0),
      finiteOr(y, 0),
      finiteOr(z, 0),
      finiteOr(qx, 0),
      finiteOr(qy, 0),
      finiteOr(qz, 0),
      finiteOr(qw, 1),
    );
  }

  // --- shapes ---

  addBox(body: BodyHandle, half: Vec3, material: ShapeMaterial = {}): ShapeHandle {
    this.assertLive();
    const { density = 1, friction = 0.6, restitution = 0, rollingResistance = 0 } = material;
    const [hx, hy, hz] = half;
    return this.mod.exports.b3bridge_add_box_shape(
      body,
      finiteOr(hx, 0.5),
      finiteOr(hy, 0.5),
      finiteOr(hz, 0.5),
      finiteOr(density, 1),
      finiteOr(friction, 0.6),
      finiteOr(restitution, 0),
      Math.max(0, finiteOr(rollingResistance, 0)),
    ) as ShapeHandle;
  }

  addSphere(body: BodyHandle, radius: number, material: ShapeMaterial = {}): ShapeHandle {
    this.assertLive();
    const { density = 1, friction = 0.6, restitution = 0, rollingResistance = 0 } = material;
    return this.mod.exports.b3bridge_add_sphere_shape(
      body,
      finiteOr(radius, 0.5),
      finiteOr(density, 1),
      finiteOr(friction, 0.6),
      finiteOr(restitution, 0),
      Math.max(0, finiteOr(rollingResistance, 0)),
    ) as ShapeHandle;
  }

  addCapsule(
    body: BodyHandle,
    radius: number,
    halfHeight: number,
    material: ShapeMaterial = {},
  ): ShapeHandle {
    this.assertLive();
    const { density = 1, friction = 0.6, restitution = 0, rollingResistance = 0 } = material;
    return this.mod.exports.b3bridge_add_capsule_shape(
      body,
      finiteOr(radius, 0.2),
      finiteOr(halfHeight, 0.5),
      finiteOr(density, 1),
      finiteOr(friction, 0.6),
      finiteOr(restitution, 0),
      Math.max(0, finiteOr(rollingResistance, 0)),
    ) as ShapeHandle;
  }

  addSensorBox(body: BodyHandle, half: Vec3): ShapeHandle {
    this.assertLive();
    const [hx, hy, hz] = half;
    return this.mod.exports.b3bridge_add_sensor_box_shape(
      body,
      finiteOr(hx, 0.5),
      finiteOr(hy, 0.5),
      finiteOr(hz, 0.5),
    ) as ShapeHandle;
  }

  /** Update a shape's friction after creation (bridge round 2). */
  setShapeFriction(shape: ShapeHandle, friction: number): void {
    this.assertLive();
    this.mod.exports.b3bridge_setShapeFriction(shape, finiteOr(friction, 0.6));
  }

  /** Update a shape's restitution after creation (bridge round 2). */
  setShapeRestitution(shape: ShapeHandle, restitution: number): void {
    this.assertLive();
    this.mod.exports.b3bridge_setShapeRestitution(shape, finiteOr(restitution, 0));
  }

  // --- velocities / forces / impulses / kinematics ---

  setLinearVelocity(body: BodyHandle, v: Vec3): void {
    this.assertLive();
    this.mod.exports.b3bridge_set_linear_velocity(
      body,
      finiteOr(v[0], 0),
      finiteOr(v[1], 0),
      finiteOr(v[2], 0),
    );
  }

  getLinearVelocity(body: BodyHandle): Vec3Out;
  getLinearVelocity<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
  getLinearVelocity(body: BodyHandle, out?: Vec3Out | Float32Array): Vec3Out | Float32Array {
    this.assertLive();
    return this.readVec3(this.mod.exports.b3bridge_get_linear_velocity, body, out);
  }

  setAngularVelocity(body: BodyHandle, w: Vec3): void {
    this.assertLive();
    this.mod.exports.b3bridge_setAngularVelocity(
      body,
      finiteOr(w[0], 0),
      finiteOr(w[1], 0),
      finiteOr(w[2], 0),
    );
  }

  getAngularVelocity(body: BodyHandle): Vec3Out;
  getAngularVelocity<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
  getAngularVelocity(body: BodyHandle, out?: Vec3Out | Float32Array): Vec3Out | Float32Array {
    this.assertLive();
    return this.readVec3(this.mod.exports.b3bridge_getAngularVelocity, body, out);
  }

  setLinearDamping(body: BodyHandle, damping: number): void {
    this.assertLive();
    this.mod.exports.b3bridge_setLinearDamping(body, Math.max(0, finiteOr(damping, 0)));
  }

  getLinearDamping(body: BodyHandle): number {
    this.assertLive();
    return this.mod.exports.b3bridge_getLinearDamping(body);
  }

  setAngularDamping(body: BodyHandle, damping: number): void {
    this.assertLive();
    this.mod.exports.b3bridge_setAngularDamping(body, Math.max(0, finiteOr(damping, 0)));
  }

  getAngularDamping(body: BodyHandle): number {
    this.assertLive();
    return this.mod.exports.b3bridge_getAngularDamping(body);
  }

  setGravityScale(body: BodyHandle, scale: number): void {
    this.assertLive();
    this.mod.exports.b3bridge_setGravityScale(body, finiteOr(scale, 1));
  }

  getGravityScale(body: BodyHandle): number {
    this.assertLive();
    return this.mod.exports.b3bridge_getGravityScale(body);
  }

  getBodyMass(body: BodyHandle): number {
    this.assertLive();
    return this.mod.exports.b3bridge_getBodyMass(body);
  }

  getBodyInertia(body: BodyHandle): Vec3Out;
  getBodyInertia<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
  getBodyInertia(
    body: BodyHandle,
    out?: Vec3Out | Float32Array,
  ): Vec3Out | Float32Array {
    this.assertLive();
    return this.readVec3(this.mod.exports.b3bridge_getBodyInertia, body, out);
  }

  setBodyInertia(body: BodyHandle, diagonal: Vec3): void {
    this.assertLive();
    const [ixx, iyy, izz] = diagonal;
    if (![ixx, iyy, izz].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError(
        'box3d-web: body inertia diagonal values must be finite and greater than zero.',
      );
    }
    this.mod.exports.b3bridge_setBodyInertia(body, ixx, iyy, izz);
  }

  private readVec3(
    fn: (bodyHandle: number, outPtr: Ptr) => void,
    body: BodyHandle,
    out?: Vec3Out | Float32Array,
  ): Vec3Out | Float32Array {
    const ptr = this.vectorScratch.ensure(3 * 4);
    fn(body, ptr);
    const heap = this.mod.HEAPF32;
    const i = ptr >> 2;
    const x = heap[i];
    const y = heap[i + 1];
    const z = heap[i + 2];
    if (out instanceof Float32Array) {
      if (out.length < 3) {
        throw new RangeError('box3d-web: Vec3 Float32Array out must have length ≥ 3.');
      }
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    }
    if (out) {
      out.x = x;
      out.y = y;
      out.z = z;
      return out;
    }
    return { x, y, z };
  }

  applyImpulse(body: BodyHandle, impulse: Vec3, at?: Vec3): void {
    this.assertLive();
    const [ix, iy, iz] = impulse;
    const [px, py, pz] = at ?? [0, 0, 0];
    this.mod.exports.b3bridge_apply_impulse(
      body,
      finiteOr(ix, 0),
      finiteOr(iy, 0),
      finiteOr(iz, 0),
      finiteOr(px, 0),
      finiteOr(py, 0),
      finiteOr(pz, 0),
    );
  }

  applyImpulseToCenter(body: BodyHandle, impulse: Vec3): void {
    this.assertLive();
    this.mod.exports.b3bridge_applyImpulseToCenter(
      body,
      finiteOr(impulse[0], 0),
      finiteOr(impulse[1], 0),
      finiteOr(impulse[2], 0),
    );
  }

  applyForce(body: BodyHandle, force: Vec3, at?: Vec3): void {
    this.assertLive();
    // If a world-space application point is given AND this build exports the
    // at-point wrapper (bridge round 2), apply there (may impart torque). Older
    // builds without `b3bridge_applyForceAt` fall back to center-of-mass and
    // silently ignore `at` (documented pre-round-2 behavior).
    if (at && typeof this.mod.exports.b3bridge_applyForceAt === 'function') {
      const [px, py, pz] = at;
      this.mod.exports.b3bridge_applyForceAt(
        body,
        finiteOr(force[0], 0),
        finiteOr(force[1], 0),
        finiteOr(force[2], 0),
        finiteOr(px, 0),
        finiteOr(py, 0),
        finiteOr(pz, 0),
      );
      return;
    }
    this.mod.exports.b3bridge_applyForce(
      body,
      finiteOr(force[0], 0),
      finiteOr(force[1], 0),
      finiteOr(force[2], 0),
    );
  }

  applyTorque(body: BodyHandle, torque: Vec3): void {
    this.assertLive();
    this.mod.exports.b3bridge_applyTorque(
      body,
      finiteOr(torque[0], 0),
      finiteOr(torque[1], 0),
      finiteOr(torque[2], 0),
    );
  }

  setKinematicTarget(body: BodyHandle, position: Vec3, rotation: Quat, dt: number): void {
    this.assertLive();
    const [x, y, z] = position;
    const [qx, qy, qz, qw] = rotation;
    this.mod.exports.b3bridge_set_kinematic_target(
      body,
      finiteOr(x, 0),
      finiteOr(y, 0),
      finiteOr(z, 0),
      finiteOr(qx, 0),
      finiteOr(qy, 0),
      finiteOr(qz, 0),
      finiteOr(qw, 1),
      finiteOr(dt, 1 / 60),
    );
  }

  // --- joints ---

  createSphericalJoint(
    a: BodyHandle,
    b: BodyHandle,
    options: SphericalJointOptions = {},
  ): JointHandle {
    this.assertLive();
    const [ax, ay, az] = options.anchor ?? [0, 0, 0];
    const hasCone = options.coneLimit != null && Number.isFinite(options.coneLimit);
    const hasTwist =
      options.twistLimit != null &&
      Number.isFinite(options.twistLimit[0]) &&
      Number.isFinite(options.twistLimit[1]);
    const springHertz = options.spring ? finiteOr(options.spring.hertz, 0) : 0;
    const springDamping = options.spring
      ? finiteOr(options.spring.dampingRatio ?? 0.7, 0.7)
      : 0.7;
    const motor = options.motor;
    const [mvx, mvy, mvz] = motor?.velocity ?? [0, 0, 0];
    return this.mod.exports.b3bridge_create_spherical_joint(
      this.handle,
      a,
      b,
      finiteOr(ax, 0),
      finiteOr(ay, 0),
      finiteOr(az, 0),
      boolInt(hasCone),
      hasCone ? (options.coneLimit as number) : 0,
      boolInt(hasTwist),
      hasTwist ? (options.twistLimit as readonly number[])[0] : 0,
      hasTwist ? (options.twistLimit as readonly number[])[1] : 0,
      springHertz,
      springDamping,
      boolInt(motor != null),
      finiteOr(mvx, 0),
      finiteOr(mvy, 0),
      finiteOr(mvz, 0),
      motor ? Math.max(0, finiteOr(motor.maxTorque, 0)) : 0,
    ) as JointHandle;
  }

  createRevoluteJoint(
    a: BodyHandle,
    b: BodyHandle,
    options: RevoluteJointOptions = {},
  ): JointHandle {
    this.assertLive();
    const [ax, ay, az] = options.anchor ?? [0, 0, 0];
    const [hx, hy, hz] = options.axis ?? [0, 0, 1];
    const hasLimit =
      options.limit != null &&
      Number.isFinite(options.limit[0]) &&
      Number.isFinite(options.limit[1]);
    const motor = options.motor;
    return this.mod.exports.b3bridge_create_revolute_joint(
      this.handle,
      a,
      b,
      finiteOr(ax, 0),
      finiteOr(ay, 0),
      finiteOr(az, 0),
      finiteOr(hx, 0),
      finiteOr(hy, 0),
      finiteOr(hz, 1),
      boolInt(hasLimit),
      hasLimit ? (options.limit as readonly number[])[0] : 0,
      hasLimit ? (options.limit as readonly number[])[1] : 0,
      boolInt(motor != null),
      motor ? finiteOr(motor.speed, 0) : 0,
      motor ? Math.max(0, finiteOr(motor.maxTorque, 0)) : 0,
    ) as JointHandle;
  }

  createDistanceJoint(
    a: BodyHandle,
    b: BodyHandle,
    options: DistanceJointOptions = {},
  ): JointHandle {
    this.assertLive();
    const [aax, aay, aaz] = options.anchorA ?? [0, 0, 0];
    const [abx, aby, abz] = options.anchorB ?? [0, 0, 0];
    const enableSpring = options.spring != null;
    const hertz = options.spring ? finiteOr(options.spring.hertz, 8) : 8;
    const damping = options.spring ? finiteOr(options.spring.dampingRatio ?? 0.7, 0.7) : 0.7;
    return this.mod.exports.b3bridge_create_distance_joint_ex(
      this.handle,
      a,
      b,
      finiteOr(aax, 0),
      finiteOr(aay, 0),
      finiteOr(aaz, 0),
      finiteOr(abx, 0),
      finiteOr(aby, 0),
      finiteOr(abz, 0),
      finiteOr(options.length ?? 1, 1),
      finiteOr(options.minLength ?? options.length ?? 0.1, 0.1),
      finiteOr(options.maxLength ?? options.length ?? 1, 1),
      boolInt(enableSpring),
      hertz,
      damping,
      boolInt(options.enableLimit ?? false),
    ) as JointHandle;
  }

  destroyJoint(joint: JointHandle): void {
    this.assertLive();
    this.mod.exports.b3bridge_destroyJoint(joint);
  }

  /**
   * A joint with no constraint that only disables collision between `a` and
   * `b` (v0.5 — see `Capabilities.filterJoint`). Destroy via `destroyJoint`
   * like any other joint to restore collision between the pair.
   */
  createFilterJoint(a: BodyHandle, b: BodyHandle): JointHandle {
    this.assertLive();
    return this.mod.exports.b3bridge_create_filter_joint(this.handle, a, b) as JointHandle;
  }

  /**
   * Enable/disable and retune a revolute joint's solver-integrated motor after
   * creation (v0.5 — see `Capabilities.jointMotors`). Pass `null` to disable.
   * Unlike an externally-applied torque impulse, the solver enforces
   * `maxTorque` every substep while driving toward `speed`.
   */
  setRevoluteMotor(joint: JointHandle, opts: RevoluteJointMotor | null): void {
    this.assertLive();
    if (opts == null) {
      this.mod.exports.b3bridge_set_revolute_motor(joint, 0, 0, 0);
      return;
    }
    this.mod.exports.b3bridge_set_revolute_motor(
      joint,
      1,
      finiteOr(opts.speed, 0),
      Math.max(0, finiteOr(opts.maxTorque, 0)),
    );
  }

  /**
   * Enable/disable and retune a spherical joint's solver-integrated motor
   * after creation (v0.5 — see `Capabilities.jointMotors`). Pass `null` to
   * disable. Unlike an externally-applied torque impulse, the solver enforces
   * `maxTorque` every substep while driving toward `velocity`.
   */
  setSphericalMotor(joint: JointHandle, opts: SphericalJointMotor | null): void {
    this.assertLive();
    if (opts == null) {
      this.mod.exports.b3bridge_set_spherical_motor(joint, 0, 0, 0, 0, 0);
      return;
    }
    const [vx, vy, vz] = opts.velocity;
    this.mod.exports.b3bridge_set_spherical_motor(
      joint,
      1,
      finiteOr(vx, 0),
      finiteOr(vy, 0),
      finiteOr(vz, 0),
      Math.max(0, finiteOr(opts.maxTorque, 0)),
    );
  }

  // --- queries ---

  castRayClosest(origin: Vec3, dir: Vec3): RaycastHit | null {
    this.assertLive();
    const ptr = this.vectorScratch.ensure(5 * 4);
    this.mod.exports.b3bridge_cast_ray_closest(
      this.handle,
      finiteOr(origin[0], 0),
      finiteOr(origin[1], 0),
      finiteOr(origin[2], 0),
      finiteOr(dir[0], 0),
      finiteOr(dir[1], 0),
      finiteOr(dir[2], 0),
      ptr,
    );
    const heap = this.mod.HEAPF32;
    const i = ptr >> 2;
    if (heap[i] <= 0.5) return null;
    return {
      body: (heap[i + 1] | 0) as BodyHandle,
      point: { x: heap[i + 2], y: heap[i + 3], z: heap[i + 4] },
    };
  }

  // --- events ---

  drainContactBeginEvents(): ContactBeginEvent[] {
    this.assertLive();
    const q = this.contactQueue;
    const out: ContactBeginEvent[] = [];
    for (let i = 0; i < q.length; i += 3) {
      out.push({
        bodyA: q[i] as BodyHandle,
        bodyB: q[i + 1] as BodyHandle,
        approachSpeed: q[i + 2],
      });
    }
    this.contactQueue = [];
    return out;
  }

  drainSensorEvents(): SensorEvent[] {
    this.assertLive();
    const q = this.sensorQueue;
    const out: SensorEvent[] = [];
    for (let i = 0; i < q.length; i += 2) {
      out.push({ sensor: q[i] as BodyHandle, other: q[i + 1] as BodyHandle });
    }
    this.sensorQueue = [];
    return out;
  }

  /** Writes [bodyA, bodyB, approachSpeed] tuples into `out`. Returns total
   *  accumulated count (may exceed out's tuple capacity — re-call with a bigger
   *  buffer). Drains the shared queue. */
  drainContactBeginEventsInto(out: Float32Array): number {
    this.assertLive();
    const q = this.contactQueue;
    const total = q.length / 3;
    const cap = Math.floor(out.length / 3);
    const write = Math.min(total, cap);
    for (let i = 0; i < write; i++) {
      out[i * 3] = q[i * 3];
      out[i * 3 + 1] = q[i * 3 + 1];
      out[i * 3 + 2] = q[i * 3 + 2];
    }
    this.contactQueue = [];
    return total;
  }

  /** Writes [sensor, other] tuples into `out`. Returns total accumulated count.
   *  Drains the shared queue. */
  drainSensorEventsInto(out: Int32Array): number {
    this.assertLive();
    const q = this.sensorQueue;
    const total = q.length / 2;
    const cap = Math.floor(out.length / 2);
    const write = Math.min(total, cap);
    for (let i = 0; i < write; i++) {
      out[i * 2] = q[i * 2];
      out[i * 2 + 1] = q[i * 2 + 1];
    }
    this.sensorQueue = [];
    return total;
  }

  // --- sleep control ---

  wakeBody(body: BodyHandle): void {
    this.assertLive();
    this.mod.exports.b3bridge_set_awake(body, 1);
  }

  sleepBody(body: BodyHandle): void {
    this.assertLive();
    this.mod.exports.b3bridge_set_awake(body, 0);
  }

  setAwake(body: BodyHandle, awake: boolean): void {
    this.assertLive();
    this.mod.exports.b3bridge_set_awake(body, boolInt(awake));
  }

  // --- counters ---

  awakeBodyCount(): number {
    this.assertLive();
    return this.mod.exports.b3bridge_get_awake_body_count(this.handle);
  }

  bodyCount(): number {
    this.assertLive();
    return this.mod.exports.b3bridge_get_body_count(this.handle);
  }

  // --- bulk read ---

  readTransforms(ids: Int32Array, out: Float32Array): Float32Array {
    this.assertLive();
    if (!(ids instanceof Int32Array)) {
      throw new TypeError('box3d-web: readTransforms `ids` must be an Int32Array.');
    }
    if (!(out instanceof Float32Array)) {
      throw new TypeError('box3d-web: readTransforms `out` must be a Float32Array.');
    }
    if (out.length < ids.length * 7) {
      throw new RangeError('box3d-web: readTransforms `out` must have ≥ ids.length*7 floats.');
    }

    const heap32 = this.mod.HEAP32;
    let idsPtr: Ptr;
    if (ids.buffer === heap32.buffer) {
      idsPtr = ids.byteOffset;
    } else {
      idsPtr = this.idsScratch.ensure(ids.length * 4);
      this.mod.HEAP32.set(ids, idsPtr >> 2);
    }

    const heapF32 = this.mod.HEAPF32;
    const writesDirect = out.buffer === heapF32.buffer;
    const outPtr = writesDirect
      ? out.byteOffset
      : this.transformsScratch.ensure(ids.length * 7 * 4);

    this.mod.exports.b3bridge_read_transforms(idsPtr, ids.length, outPtr);

    if (!writesDirect) {
      const src = this.mod.HEAPF32;
      out.set(src.subarray(outPtr >> 2, (outPtr >> 2) + ids.length * 7));
    }
    return out;
  }

  destroy(): void {
    if (this.disposed) return;
    this.mod.exports.b3bridge_destroy_world(this.handle);
    this.idsScratch.dispose();
    this.transformsScratch.dispose();
    this.vectorScratch.dispose();
    this.eventsScratch.dispose();
    this.contactQueue = [];
    this.sensorQueue = [];
    this.disposed = true;
  }
}
