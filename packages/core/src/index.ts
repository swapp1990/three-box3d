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
import {
  DEFAULT_HULL_MAX_VERTICES,
  HULL_MAX_VERTICES_LIMIT,
  type AABBOverlapResult,
  type BodyContactLoad,
  type BodyHandle,
  type BodyOptions,
  type BodyType,
  type Capabilities,
  type ContactBeginEvent,
  type ContactBeginEventWithShapes,
  type ContactEndEvent,
  type ContactEndEventWithShapes,
  type ContactHitEvent,
  type ContactHitEventWithShapes,
  type DistanceJointOptions,
  type HullOptions,
  type JointHandle,
  type Quat,
  type RaycastHit,
  type RevoluteJointMotor,
  type RevoluteJointOptions,
  type SensorEvent,
  type ShapeHandle,
  type ShapeIdentity,
  type ShapeMaterial,
  type SphericalJointMotor,
  type SphericalJointOptions,
  type Vec3,
  type Vec3Out,
  type WorldHandle,
  type WorldOptions,
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
  /**
   * Convex hull from body-local points (`readonly Vec3[]` or packed `Float32Array`
   * of XYZ triples). Builds **one** convex hull — concavity is not preserved.
   * Default `maxVertices` is 64; Box3D hard-caps at 255. Throws on invalid input
   * or native hull-build failure.
   */
  addHull(
    body: BodyHandle,
    points: readonly Vec3[] | Float32Array,
    options?: HullOptions,
  ): ShapeHandle;
  /** Bridge round 2 — see `Capabilities.shapeMaterial`. */
  setShapeFriction(shape: ShapeHandle, friction: number): void;
  /** Bridge round 2 — see `Capabilities.shapeMaterial`. */
  setShapeRestitution(shape: ShapeHandle, restitution: number): void;
  /** Generation-safe native identity for the shape currently occupying an
   *  active handle slot. Raw shape handles remain reusable. Throws when the
   *  shape-identity bridge capability is unavailable. */
  getShapeIdentity(shape: ShapeHandle): ShapeIdentity | null;

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
  /** World-space distance between the two anchors of a live spherical/revolute joint. */
  getJointAnchorSeparation(joint: JointHandle): number;
  /** Revolute motor torque (N·m) after the most recent step. `0` if unsupported. */
  getRevoluteMotorTorque(joint: JointHandle): number;
  getSphericalMotorTorque(joint: JointHandle): Vec3Out;
  getSphericalMotorTorque<T extends Vec3Out | Float32Array>(joint: JointHandle, out: T): T;
  getBodyContactLoad(body: BodyHandle): BodyContactLoad;
  getBodyContactLoad<T extends BodyContactLoad>(body: BodyHandle, out: T): T;

  castRayClosest(origin: Vec3, dir: Vec3): RaycastHit | null;
  /** Find all shapes whose broad-phase bounds potentially overlap world-space
   * AABB bounds. Native callback order is unspecified; compounds report their
   * outer shape only. */
  overlapAABB(lowerBound: Vec3, upperBound: Vec3): AABBOverlapResult[];
  /** Writes [bodyHandle, shape.index1, shape.world0, shape.generation] into
   * `out`; returns total matches, which may exceed the buffer capacity. */
  overlapAABBInto(lowerBound: Vec3, upperBound: Vec3, out: Float32Array): number;

  drainContactBeginEvents(): ContactBeginEvent[];
  drainContactEndEvents(): ContactEndEvent[];
  drainContactHitEvents(): ContactHitEvent[];
  drainSensorEvents(): SensorEvent[];
  drainContactBeginEventsInto(out: Float32Array): number;
  drainContactEndEventsInto(out: Float32Array): number;
  drainContactHitEventsInto(out: Float32Array): number;
  /** Shape-aware drains consume the same queues as their legacy counterparts. */
  drainContactBeginEventsWithShapes(): ContactBeginEventWithShapes[];
  drainContactEndEventsWithShapes(): ContactEndEventWithShapes[];
  drainContactHitEventsWithShapes(): ContactHitEventWithShapes[];
  drainContactBeginEventsWithShapesInto(out: Float32Array): number;
  drainContactEndEventsWithShapesInto(out: Float32Array): number;
  drainContactHitEventsWithShapesInto(out: Float32Array): number;
  drainSensorEventsInto(out: Int32Array): number;

  wakeBody(body: BodyHandle): void;
  sleepBody(body: BodyHandle): void;
  setAwake(body: BodyHandle, awake: boolean): void;

  awakeBodyCount(): number;
  bodyCount(): number;

  readTransforms(ids: Int32Array, out: Float32Array): Float32Array;
  /** Writes one byte per body (`1` awake, `0` asleep) into `out`. */
  readSleepStates(ids: Int32Array, out: Uint8Array): Uint8Array;

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
  AABBOverlapResult,
  BodyContactLoad,
  BodyHandle,
  BodyOptions,
  BodyType,
  Capabilities,
  ContactBeginEvent,
  ContactBeginEventWithShapes,
  ContactEndEvent,
  ContactEndEventWithShapes,
  ContactHitEvent,
  ContactHitEventWithShapes,
  DistanceJointOptions,
  HullOptions,
  JointHandle,
  Quat,
  RaycastHit,
  RevoluteJointMotor,
  RevoluteJointOptions,
  SensorEvent,
  ShapeHandle,
  ShapeIdentity,
  ShapeMaterial,
  SphericalJointMotor,
  SphericalJointOptions,
  Vec3,
  Vec3Out,
  WorldHandle,
  WorldOptions,
};

export { DEFAULT_HULL_MAX_VERTICES, HULL_MAX_VERTICES_LIMIT };
export {
  MAX_NATIVE_GENERATION,
  MAX_NATIVE_SHAPE_INDEX,
  MAX_NATIVE_WORLDS,
} from './limits.js';

// Helper modules (tree-shakeable named exports; none imports three).
export { FixedStepper, type FixedStepperOptions, type FixedStepperTelemetry } from './helpers/fixed-step.js';
export { TransformBuffer } from './helpers/transform-buffer.js';
export {
  SleepManager,
  type SleepManagerOptions,
} from './helpers/sleep-manager.js';
export { radialImpulse, type RadialImpulseOptions } from './helpers/radial-impulse.js';
export { BodyPool } from './helpers/body-pool.js';
export {
  ArticulatedPoseError,
  applyArticulatedPose,
  type ArticulatedPose,
  type ArticulatedPoseMeasurement,
  type ArticulatedPoseOptions,
  type ArticulatedPoseResult,
} from './helpers/articulated-pose.js';
export {
  createIdentitySystem,
  sameIdentity,
  type Identity,
  type IdentityMintScope,
  type IdentityParentOf,
  type IdentityScope,
  type IdentitySystem,
} from './helpers/identity.js';
export type {
  SceneCommandEnvelope,
  SceneCommandPolicy,
  SceneContactBatch,
  SceneParticipant,
} from './helpers/scene-participant.js';
export {
  createEntityRegistry,
  EntityRegistry,
  type EntityRegistryOptions,
  type EntityRegistrySnapshot,
  type EntityRegistryStats,
  type RegisteredBody,
  type RegisteredShape,
} from './helpers/entity-registry.js';
export {
  createSceneRuntime,
  SceneRuntime,
  type SceneCommandInput,
  type SceneEventEnvelope,
  type SceneRuntimeOptions,
  type SceneRuntimeTelemetry,
} from './helpers/scene-runtime.js';
export {
  createRegistrationHost,
  RegistrationHost,
  spawnRegistered,
  type RegistrationHostOptions,
  type RegistrationHostSnapshot,
  type RegistrationWorld,
  type SpawnedShape,
  type SpawnRegisteredOptions,
  type SpawnRegisteredResult,
  type SpawnShapeSpec,
  type SpawnWorld,
} from './helpers/transactional-spawn.js';
