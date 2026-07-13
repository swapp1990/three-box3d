/**
 * box3d-web — framework-agnostic core of three-box3d.
 *
 * WASM loader + typed handle API + hardened runtime helpers. Zero runtime deps, no
 * `three` import anywhere. See docs/api-design.md for the frozen v0.1 contract.
 *
 * Quickstart (note the loud, explicit await — "why is physics undefined" is the #1
 * support question in every WASM physics lib):
 *
 *   import { createBox3D } from 'box3d-web';
 *   const b3 = await createBox3D();
 *   const world = b3.createWorld({ gravity: [0, -9.81, 0] });
 */
import { computeCapabilities } from './capabilities.js';
import type { Box3DModule } from './raw-module.js';
import type {
  BodyHandle,
  BodyOptions,
  BodyType,
  Capabilities,
  ContactBeginEvent,
  DistanceJointOptions,
  JointHandle,
  Quat,
  RaycastHit,
  RevoluteJointMotor,
  RevoluteJointOptions,
  SensorEvent,
  ShapeHandle,
  ShapeMaterial,
  SphericalJointMotor,
  SphericalJointOptions,
  Vec3,
  Vec3Out,
  WorldHandle,
  WorldOptions,
} from './types.js';
import { loadBox3DModule, type WasmLoadOptions } from './wasm-loader.js';
import { WorldImpl } from './world.js';

// Package/native version metadata. `lib` tracks package.json; box3d + emscripten
// are pinned by the native build (see native/BOX3D_VERSION, build-wasm.sh).
const VERSION = {
  lib: '0.0.0',
  box3d: 'v0.1.0',
  emscripten: '6.0.2',
} as const;

/** Loading strategy for the WASM binary. */
export interface Box3DLoadOptions extends WasmLoadOptions {}

/**
 * Method-bag view over a WorldHandle. Cheap wrapper; holds no per-body state.
 * This interface is the sole public call surface — there are no free-function
 * variants in v0.1.
 */
export interface World {
  readonly handle: WorldHandle;

  step(dt: number, substeps?: number): void;
  /** Set the full gravity vector (x,y,z). Bridge round 2 — see `Capabilities.setGravity`. */
  setGravity(gravity: Vec3): void;

  createBody(options?: BodyOptions): BodyHandle;
  destroyBody(body: BodyHandle): void;
  setBodyType(body: BodyHandle, type: BodyType): void;
  /** Bridge round 2. Returns `null` for an invalid handle or an older build
   *  without this export — see `Capabilities.bodyQueries`. */
  getBodyType(body: BodyHandle): BodyType | null;
  /** Bridge round 2 — see `Capabilities.bodyQueries`. */
  isBodyAwake(body: BodyHandle): boolean;
  setBodyTransform(body: BodyHandle, position: Vec3, rotation: Quat): void;

  addBox(body: BodyHandle, half: Vec3, material?: ShapeMaterial): ShapeHandle;
  addSphere(body: BodyHandle, radius: number, material?: ShapeMaterial): ShapeHandle;
  addCapsule(
    body: BodyHandle,
    radius: number,
    halfHeight: number,
    material?: ShapeMaterial,
  ): ShapeHandle;
  addSensorBox(body: BodyHandle, half: Vec3): ShapeHandle;
  /** Bridge round 2 — see `Capabilities.shapeMaterial`. */
  setShapeFriction(shape: ShapeHandle, friction: number): void;
  /** Bridge round 2 — see `Capabilities.shapeMaterial`. */
  setShapeRestitution(shape: ShapeHandle, restitution: number): void;

  setLinearVelocity(body: BodyHandle, v: Vec3): void;
  getLinearVelocity(body: BodyHandle): Vec3Out;
  getLinearVelocity<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
  setAngularVelocity(body: BodyHandle, w: Vec3): void;
  getAngularVelocity(body: BodyHandle): Vec3Out;
  getAngularVelocity<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
  setLinearDamping(body: BodyHandle, damping: number): void;
  getLinearDamping(body: BodyHandle): number;
  setAngularDamping(body: BodyHandle, damping: number): void;
  getAngularDamping(body: BodyHandle): number;
  setGravityScale(body: BodyHandle, scale: number): void;
  getGravityScale(body: BodyHandle): number;
  getBodyMass(body: BodyHandle): number;
  /** Local-space diagonal rotational inertia `(Ixx, Iyy, Izz)`, in kg*m^2. */
  getBodyInertia(body: BodyHandle): Vec3Out;
  getBodyInertia<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
  /** Override the positive local-space diagonal inertia tensor while preserving
   *  the body's existing mass and center of mass. */
  setBodyInertia(body: BodyHandle, diagonal: Vec3): void;

  applyImpulse(body: BodyHandle, impulse: Vec3, at?: Vec3): void;
  /** Apply an instantaneous linear impulse through the center of mass. */
  applyImpulseToCenter(body: BodyHandle, impulse: Vec3): void;
  /** `at` (world point) is honored on builds with `Capabilities.forceAtPoint`
   *  (bridge round 2); older builds apply at the center of mass and ignore `at`. */
  applyForce(body: BodyHandle, force: Vec3, at?: Vec3): void;
  applyTorque(body: BodyHandle, torque: Vec3): void;
  setKinematicTarget(body: BodyHandle, position: Vec3, rotation: Quat, dt: number): void;

  createSphericalJoint(a: BodyHandle, b: BodyHandle, options?: SphericalJointOptions): JointHandle;
  createRevoluteJoint(a: BodyHandle, b: BodyHandle, options?: RevoluteJointOptions): JointHandle;
  createDistanceJoint(a: BodyHandle, b: BodyHandle, options?: DistanceJointOptions): JointHandle;
  /** A joint with no constraint that only disables collision between `a` and
   *  `b` (v0.5 — see `Capabilities.filterJoint`). Destroy via `destroyJoint`. */
  createFilterJoint(a: BodyHandle, b: BodyHandle): JointHandle;
  destroyJoint(joint: JointHandle): void;

  /** Enable/disable + retune a revolute joint's solver-integrated motor.
   *  `null` disables (v0.5 — see `Capabilities.jointMotors`). */
  setRevoluteMotor(joint: JointHandle, opts: RevoluteJointMotor | null): void;
  /** Enable/disable + retune a spherical joint's solver-integrated motor.
   *  `null` disables (v0.5 — see `Capabilities.jointMotors`). */
  setSphericalMotor(joint: JointHandle, opts: SphericalJointMotor | null): void;

  castRayClosest(origin: Vec3, dir: Vec3): RaycastHit | null;

  drainContactBeginEvents(): ContactBeginEvent[];
  drainSensorEvents(): SensorEvent[];
  drainContactBeginEventsInto(out: Float32Array): number;
  drainSensorEventsInto(out: Int32Array): number;

  wakeBody(body: BodyHandle): void;
  sleepBody(body: BodyHandle): void;
  setAwake(body: BodyHandle, awake: boolean): void;

  awakeBodyCount(): number;
  bodyCount(): number;

  readTransforms(ids: Int32Array, out: Float32Array): Float32Array;

  destroy(): void;
}

/** A loaded box3d module. Owns the WASM memory + scratch buffers for all its worlds. */
export interface Box3D {
  createWorld(options?: WorldOptions): World;
  capabilities(): Capabilities;
  dispose(): void;
  readonly version: { lib: string; box3d: string; emscripten: string };
}

// Bridge the WorldImpl → module lookup for the standalone probeCapabilities.
const moduleOfWorld = new WeakMap<WorldImpl, Box3DModule>();

class Box3DImpl implements Box3D {
  private disposed = false;
  private capsCache: Capabilities | null = null;
  private readonly worlds = new Set<WorldImpl>();

  constructor(private readonly mod: Box3DModule) {}

  private assertLive(): void {
    if (this.disposed) {
      throw new Error('box3d-web: Box3D instance used after dispose().');
    }
  }

  private createWorldImpl(options: WorldOptions): WorldImpl {
    this.assertLive();
    const [gravityX, gravityY, gravityZ] = options.gravity ?? [0, -9.81, 0];
    const handle = this.mod.exports.b3bridge_create_world(
      Number.isFinite(gravityX) ? gravityX : 0,
      Number.isFinite(gravityY) ? gravityY : -9.81,
      Number.isFinite(gravityZ) ? gravityZ : 0,
      options.enableSleep === false ? 0 : 1,
      options.enableContinuous === false ? 0 : 1,
    ) as WorldHandle;
    const world = new WorldImpl(this.mod, handle);
    moduleOfWorld.set(world, this.mod);
    this.worlds.add(world);
    const originalDestroy = world.destroy.bind(world);
    world.destroy = () => {
      this.worlds.delete(world);
      originalDestroy();
    };
    return world;
  }

  createWorld(options: WorldOptions = {}): World {
    return this.createWorldImpl(options);
  }

  capabilities(): Capabilities {
    this.assertLive();
    if (this.capsCache) return this.capsCache;
    // Probe against a throwaway world so the result reflects THIS build.
    const world = this.createWorldImpl({});
    try {
      this.capsCache = computeCapabilities(this.mod, world);
    } finally {
      world.destroy();
    }
    return this.capsCache;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const world of [...this.worlds]) {
      world.destroy();
    }
    this.worlds.clear();
    this.disposed = true;
  }

  get version(): { lib: string; box3d: string; emscripten: string } {
    return { ...VERSION };
  }
}

/**
 * Create an independent box3d instance. Loads + instantiates the WASM, wires every
 * env import, runs static ctors. MUST be awaited before any world call. Rejects
 * (never returns null) on load/link failure.
 */
export async function createBox3D(options?: Box3DLoadOptions): Promise<Box3D> {
  const mod = await loadBox3DModule(options ?? {});
  return new Box3DImpl(mod);
}

/**
 * Standalone capabilities probe (same result as `Box3D.capabilities()`), for
 * callers holding only a World. Cached per world.
 */
export function probeCapabilities(world: World): Capabilities {
  const impl = world as unknown as WorldImpl;
  const mod = moduleOfWorld.get(impl);
  if (!mod) {
    throw new TypeError(
      'box3d-web: probeCapabilities received a World not created by createBox3D().',
    );
  }
  return computeCapabilities(mod, impl);
}

export type {
  BodyHandle,
  BodyOptions,
  BodyType,
  Capabilities,
  ContactBeginEvent,
  DistanceJointOptions,
  JointHandle,
  Quat,
  RaycastHit,
  RevoluteJointMotor,
  RevoluteJointOptions,
  SensorEvent,
  ShapeHandle,
  ShapeMaterial,
  SphericalJointMotor,
  SphericalJointOptions,
  Vec3,
  Vec3Out,
  WorldHandle,
  WorldOptions,
};

// Helper modules (tree-shakeable named exports; none imports three).
export { FixedStepper, type FixedStepperOptions } from './helpers/fixed-step.js';
export { TransformBuffer } from './helpers/transform-buffer.js';
export {
  SleepManager,
  type SleepManagerOptions,
} from './helpers/sleep-manager.js';
export { radialImpulse, type RadialImpulseOptions } from './helpers/radial-impulse.js';
export { BodyPool } from './helpers/body-pool.js';
