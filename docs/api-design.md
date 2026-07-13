# `box3d-web` v0.1 — Public API Design

> Framework-agnostic core of **three-box3d**. WASM loader + typed handle API + six
> hardened runtime helpers. Zero runtime deps, no `three` import anywhere.
>
> **Status:** reviewed and **frozen for v0.1**. Wraps `box3d@v0.1.0` (Erin Catto),
> built with Emscripten 6.0.2. Tagline: *"3D physics for the web, powered by box3d."*

---

## Design sign-off

**Reviewed and frozen for v0.1 on 2026-07-09.** Independent review returned
APPROVE-WITH-CHANGES; the product lead accepted all 10 changes and they are applied
in this document. The five open questions were ruled as follows and are settled:

1. **Methods-only.** `World` methods are the sole surface — no free-function
   variants are promised or shipped in v0.1.
2. **`ShapeHandle` is returned** by `addBox`/`addSphere`/`addCapsule`/`addSensorBox`
   in v0.1, even though per-shape mutation only lands in v0.5.
3. **`drainContactBeginEventsInto` / `drainSensorEventsInto` SHIP in v0.1** —
   implemented now to prove the shared-queue contract early; the object-returning
   drains remain the documented default.
4. **Tuple-in / object-out stands.** Inputs are readonly `Vec3`/`Quat` tuples; the
   mutable read path takes `Vec3Out | Float32Array`.
5. **`SleepManager` takes the `TransformBuffer` as a parameter** (does not own it),
   so one buffer feeds sleep + `radialImpulse` + the three-box3d adapter.

Everything else is approved as-is and frozen: init story, branded handles, joint
options, units, migration table structure, and the consumer walkthrough.

---

## 1. Design principles

**Buffer-oriented, not object-oriented.** box3d simulates thousands of bodies; a
JS object per body is the thing that kills the InstancedMesh story. The read path is
one bulk copy into a flat `Float32Array` (7 floats/body), read once per frame. There
is deliberately **no `Body` class, no scene mirror, no per-body reactive wrapper**.
This is the sharpest contrast with Rapier's object model and the core of why we sync
to InstancedMesh cheaply.

**Handles, not objects.** Bodies/worlds/shapes/joints are branded opaque integers
(`WorldHandle`, `BodyHandle`, …). Branding is compile-time only — at runtime they are
the raw `number` the bridge returns, so passing a `BodyHandle` where a `WorldHandle`
is wanted is a **type error**, with zero runtime cost and zero allocation.

**Physics owns transforms; visuals stay in three.js.** The core never touches
`three`. It produces transform buffers; the `three-box3d` adapter (separate package)
copies them into `Object3D`/`InstancedMesh`. `setState`-per-frame is an anti-pattern
we design against.

**Explicit async init, loud everywhere.** `const b3 = await createBox3D()`. No module
singleton, no lazy global. "Why is physics `undefined`?" is the #1 support question in
every WASM physics lib — every quickstart leads with the `await`. Multiple independent
`Box3D` instances (and multiple worlds per instance) are fully supported.

**Tree-shakeable helper modules.** The six hardened helpers (`FixedStepper`,
`TransformBuffer`, `SleepManager`, `radialImpulse`, `BodyPool`, `probeCapabilities`)
are first-class named exports with their own small APIs. They take a `World` (or plain
callbacks) as input — they are composable, not baked into a god-object. Import only
what you use; the WASM core does not depend on any of them.

---

## 2. API listing (`.d.ts`-style)

### 2.1 Entry point & loading

```ts
/** Loading strategy for the WASM binary. */
export interface Box3DLoadOptions {
  /** Override the URL the loader fetches box3d.wasm from. Ignored by the
   *  base64-inlined `compat` build (which has no separate asset). */
  wasmUrl?: string | URL;
  /** Provide the wasm bytes directly (advanced: custom fetch, Node fs, cache).
   *  Takes precedence over `wasmUrl`. */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /** Emscripten-style file resolver, kept for parity with the raw loader.
   *  `locateFile('box3d.wasm')` → URL. `wasmUrl`/`wasmBinary` win over this. */
  locateFile?: (path: string) => string;
}

/**
 * Create an independent box3d instance. Loads + instantiates the WASM, wires
 * every env import, runs `_initialize`. MUST be awaited before any world call.
 * Resolves to a `Box3D` factory. Rejects (never returns null) on load/link failure.
 *
 * Import path selects the WASM packaging:
 *   import { createBox3D } from 'box3d-web'          // compat: wasm base64-inlined (default)
 *   import { createBox3D } from 'box3d-web/separate' // separate .wasm asset (smaller, needs bundler cfg)
 *
 * Threading: v0.1 runs on the thread that created the instance (main thread OR a
 * worker — both work); cross-thread transfer of buffers/handles is out of scope.
 */
export function createBox3D(options?: Box3DLoadOptions): Promise<Box3D>;

/** A loaded box3d module. Owns the WASM memory + scratch buffers for all its worlds. */
export interface Box3D {
  /** Create a physics world. */
  createWorld(options?: WorldOptions): World;
  /** Feature probe against THIS module build (see §2.9). Cheap, cached. */
  capabilities(): Capabilities;
  /** Free all scratch buffers held by this module. Worlds should be destroyed first.
   *  After dispose the instance is unusable. */
  dispose(): void;
  /** Semver of box3d-web + the wrapped native commit, for bug reports. */
  readonly version: { lib: string; box3d: string; emscripten: string };
}
```

### 2.2 Branded handles

```ts
declare const brand: unique symbol;
/** Opaque handle to a world. Runtime value is the bridge integer. */
export type WorldHandle = number & { readonly [brand]: 'World' };
export type BodyHandle  = number & { readonly [brand]: 'Body' };
export type ShapeHandle = number & { readonly [brand]: 'Shape' };
export type JointHandle = number & { readonly [brand]: 'Joint' };
```

> Handles are *values*, not the `World` object. `World` (below) is a thin method
> bag bound to a `WorldHandle` and is the **only** call surface — there are no
> free-function variants in v0.1. `body`, `shape`, `joint` handles are plain
> values passed around freely.

> **Primary footgun — cross-world handle misuse.** Handles are branded by *kind*,
> not by *world*: a `BodyHandle` created in world A is a valid-looking integer that
> will silently alias a different body if passed to world B's methods. The type
> system cannot catch this; the bridge treats it as any other slot lookup. Keep
> handles scoped to the world that created them. A DEV-only build that tags handles
> with their world and throws on mismatch is a **v0.5 candidate**.

### 2.3 World lifecycle

```ts
/** Right-handed, Y-up, meters, kilograms, seconds. Quaternions are (x,y,z,w). */
export interface WorldOptions {
  /** Gravity vector, m/s². Default `[0, -9.81, 0]`. */
  gravity?: Vec3;
  /** Enable body sleeping (island-level). Default `true`. */
  enableSleep?: boolean;
  /** Enable continuous collision globally. Default `true`. */
  enableContinuous?: boolean;
}

/** Method-bag view over a WorldHandle. Cheap wrapper; holds no per-body state. */
export interface World {
  readonly handle: WorldHandle;

  /** Advance the sim by `dt` seconds with `substeps` solver iterations.
   *  Call from a FixedStepper, not per rAF-frame directly. Default substeps 4. */
  step(dt: number, substeps?: number): void;

  createBody(options?: BodyOptions): BodyHandle;
  destroyBody(body: BodyHandle): void;

  /** Attach a shape/fixture to a body. Returns the shape handle. */
  addBox(body: BodyHandle, half: Vec3, material?: ShapeMaterial): ShapeHandle;
  addSphere(body: BodyHandle, radius: number, material?: ShapeMaterial): ShapeHandle;
  /** Y-aligned capsule. `halfHeight` is the cylinder half-length (excl. caps). */
  addCapsule(body: BodyHandle, radius: number, halfHeight: number, material?: ShapeMaterial): ShapeHandle;
  /** Sensor (non-solid) box — fires sensor events, no contact response. */
  addSensorBox(body: BodyHandle, half: Vec3): ShapeHandle;

  // velocities / forces / impulses / kinematics — see §2.5
  // joints — see §2.6
  // queries — see §2.7
  // events — see §2.8
  // sleep — see §2.9
  // bulk read — see §2.10

  /** Number of bodies whose island is awake. `-1` if the build lacks the probe. */
  awakeBodyCount(): number;
  /** Total bodies in this world. */
  bodyCount(): number;

  /** Destroy the world and every body/shape/joint in it. Handle is invalid after. */
  destroy(): void;
}
```

### 2.4 Bodies & shapes

```ts
export type BodyType = 'static' | 'kinematic' | 'dynamic';

export interface BodyOptions {
  type?: BodyType;                 // default 'dynamic'
  position?: Vec3;                 // default [0,0,0]
  rotation?: Quat;                 // (x,y,z,w), default [0,0,0,1]
  /** Continuous collision (bullet) for this body. Default false. */
  ccd?: boolean;
  linearDamping?: number;          // default 0
  angularDamping?: number;         // default 0
  gravityScale?: number;           // default 1
}

/** Per-shape material. All optional; defaults match box3d/app conventions. */
export interface ShapeMaterial {
  density?: number;     // default 1  (kg/m³-ish; box3d units)
  friction?: number;    // default 0.6
  restitution?: number; // default 0  (bounciness, 0..1)
  rollingResistance?: number; // default 0; spheres/capsules only
}

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // (x,y,z,w)
```

`World` body/type methods:

```ts
setBodyType(body: BodyHandle, type: BodyType): void;
/** Teleport a body (position + rotation), bypassing the solver. Wakes it.
 *  For kinematic *animation* prefer `setKinematicTarget` (velocity-correct). */
setBodyTransform(body: BodyHandle, position: Vec3, rotation: Quat): void;
```

### 2.5 Velocities, forces, impulses, kinematic targets

```ts
setLinearVelocity(body: BodyHandle, v: Vec3): void;
/** `out` is filled and returned if given (reuse it for zero-alloc reads). A
 *  `Float32Array` out (length ≥ 3) enables writing straight into shared buffers. */
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
/** Mass derived from attached shape density and geometry, in kilograms. */
getBodyMass(body: BodyHandle): number;
/** Local-space diagonal rotational inertia `(Ixx, Iyy, Izz)`, in kg*m^2. */
getBodyInertia(body: BodyHandle): Vec3Out;
getBodyInertia<T extends Vec3Out | Float32Array>(body: BodyHandle, out: T): T;
/** Override the positive local diagonal tensor, preserving existing mass and
 *  center of mass. Throws RangeError for non-finite or non-positive axes. */
setBodyInertia(body: BodyHandle, diagonal: Vec3): void;

/** Instantaneous impulse (kg·m/s) at world point `at`. Wakes the body. */
applyImpulse(body: BodyHandle, impulse: Vec3, at?: Vec3): void;
/** Instantaneous impulse through the body's center of mass. Wakes the body. */
applyImpulseToCenter(body: BodyHandle, impulse: Vec3): void;
/** Continuous force (N), consumed at the next step. Wakes the body. */
applyForce(body: BodyHandle, force: Vec3, at?: Vec3): void;
/** Continuous torque (N·m), consumed at the next step. */
applyTorque(body: BodyHandle, torque: Vec3): void;

/** Drive a kinematic body toward a pose over `dt`; box3d derives the velocity so
 *  contacts resolve correctly (the drag-joint / crane pattern). Wakes it. */
setKinematicTarget(body: BodyHandle, position: Vec3, rotation: Quat, dt: number): void;

/** Mutable out-param to avoid per-call allocation. */
export type Vec3Out = { x: number; y: number; z: number };
```

### 2.6 Joints

```ts
export interface SphericalJointOptions {
  anchor?: Vec3;                    // world anchor, default at bodyA origin
  coneLimit?: number;               // radians; omit = unlimited
  twistLimit?: [lower: number, upper: number]; // radians; omit = unlimited
  spring?: { hertz: number; dampingRatio?: number }; // dampingRatio default 0.7
}
createSphericalJoint(a: BodyHandle, b: BodyHandle, options?: SphericalJointOptions): JointHandle;

export interface RevoluteJointOptions {
  anchor?: Vec3;                    // world anchor
  axis?: Vec3;                      // world hinge axis, default +Z
  limit?: [lower: number, upper: number]; // radians; omit = free spin
}
createRevoluteJoint(a: BodyHandle, b: BodyHandle, options?: RevoluteJointOptions): JointHandle;

export interface DistanceJointOptions {
  anchorA?: Vec3;                   // local to A, default origin
  anchorB?: Vec3;                   // local to B, default origin
  length?: number;                  // rest length, default current distance
  minLength?: number;
  maxLength?: number;
  spring?: { hertz: number; dampingRatio?: number };
  enableLimit?: boolean;            // clamp to [minLength, maxLength]
}
createDistanceJoint(a: BodyHandle, b: BodyHandle, options?: DistanceJointOptions): JointHandle;

/** Destroy a joint (NEW in v0.1 bridge). Removes the drag-joint "destroy the hand
 *  body" hack — you can now release a drag joint without destroying its anchor. */
destroyJoint(joint: JointHandle): void;
```

### 2.7 Queries

```ts
export interface RaycastHit {
  body: BodyHandle;
  /** World hit point. Freshly allocated per call — NOT a reused scratch object
   *  (deliberately not `Vec3Out`, which labels caller-reused mutable outs). */
  point: Readonly<{ x: number; y: number; z: number }>;
  // v0.5 adds: normal, shape, fraction (bridge does not yet return them)
}
/** Closest hit along the ray `origin → origin + dir` (dir carries max distance).
 *  Returns `null` on no hit — this is the one query that legitimately misses. */
castRayClosest(origin: Vec3, dir: Vec3): RaycastHit | null;
```

### 2.8 Events

```ts
export interface ContactBeginEvent {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** Approach speed at contact (m/s) — use for impact-scaled VFX/sound. */
  approachSpeed: number;
}
export interface SensorEvent {
  sensor: BodyHandle;   // the sensor body
  other: BodyHandle;    // the body that entered
}

/** Drain contact-begin events accumulated since the last drain. Allocates an array. */
drainContactBeginEvents(): ContactBeginEvent[];
/** Drain sensor-enter events accumulated since the last drain. Allocates an array. */
drainSensorEvents(): SensorEvent[];

/**
 * Allocation-free drain (SHIPS in v0.1 — implemented now so the hot path is proven
 * before v0.5 makes it the recommended default). Writes flat tuples into a caller
 * buffer and returns the total accumulated count (which may exceed the buffer's
 * tuple capacity — re-call with a larger buffer, mirroring the bridge retry).
 * The object-returning variants above remain the documented default.
 */
drainContactBeginEventsInto(out: Float32Array): number; // tuple = [bodyA, bodyB, approachSpeed]
drainSensorEventsInto(out: Int32Array): number;         // tuple = [sensor, other]
```

> **Draining contract (frozen):** events **accumulate until drained** — nothing is
> silently overwritten at step boundaries. A drain returns everything accumulated
> since the previous drain and empties the queue, so calling the same drain twice in
> one frame returns only newly accumulated events on the second call (typically an
> empty result unless a `step()` ran in between). The array and `…Into` variants read
> the **same queue** — mixing them within a frame splits the events between the two
> calls. The recommended pattern remains one drain per `step()`.

### 2.9 Sleep control & capabilities

```ts
wakeBody(body: BodyHandle): void;
sleepBody(body: BodyHandle): void;
setAwake(body: BodyHandle, awake: boolean): void;

/**
 * Which optional native probes this WASM build supports. box3d is pre-1.0 and the
 * bridge may be recompiled with fewer exports; helpers degrade gracefully on `false`.
 *
 * The feature set is ADD-ONLY across versions: fields are never removed or renamed,
 * only added (minor releases may add fields; that is not a breaking change). For
 * forward-compat probing of features newer than your typings, use `has()`.
 */
export interface Capabilities {
  awakeBodyCount: boolean;
  bodyCount: boolean;
  setAwake: boolean;
  setBodyType: boolean;        // yardPhysics probes this (crane body-type flips)
  getLinearVelocity: boolean;  // yardPhysics probes this (ball speed checks)
  castRay: boolean;
  explode: boolean;      // present, but see radialImpulse — native explode no-ops on sleepers
  angularVelocity: boolean;
  forces: boolean;
  setBodyTransform: boolean;
  bodyInertia: boolean;  // local diagonal rotational-inertia telemetry
  setBodyInertia: boolean; // local diagonal override; preserves mass/center
  /** Open-ended probe for features added after these typings were published. */
  has(feature: string): boolean;
}
```

### 2.10 Bulk transform read

```ts
/**
 * Bulk-read body poses into a flat Float32Array: 7 floats/body [x,y,z, qx,qy,qz,qw].
 * `out` MUST be ≥ ids.length*7. Invalid/destroyed bodies read as
 * [NaN,NaN,NaN, 0,0,0,1]. If `out` is backed by WASM heap the copy is skipped.
 * This is THE per-frame read — call once, then let three-box3d sync it.
 * Returns `out` for chaining.
 */
readTransforms(ids: Int32Array, out: Float32Array): Float32Array;
```

### 2.11 The six helper modules

Each is a named export from `box3d-web` (also re-exported from subpaths for
selective import, e.g. `box3d-web/helpers`). None imports `three`.

#### `FixedStepper`
```ts
export interface FixedStepperOptions {
  fixedDt?: number;      // default 1/60
  substeps?: number;     // default 4
  maxDeltaClamp?: number; // clamp a single frame delta, default 0.1 s
  maxStepsPerFrame?: number; // death-spiral guard, default 3 (drops backlog via modulo)
}
export class FixedStepper {
  constructor(options?: FixedStepperOptions);
  /** Feed a frame delta; runs 0..maxStepsPerFrame fixed steps via `onStep`.
   *  Returns how many steps ran (0 = no visual change needed). */
  advance(delta: number, onStep: (dt: number) => void): number;
  /** Total simulated time (s), monotone in fixed increments. */
  readonly simTime: number;
  reset(): void;
}
```

#### `TransformBuffer`
```ts
/**
 * Owns the Int32Array id list + Float32Array 7-float pose layout, with dirty
 * rebuild. The buffer you hand to World.readTransforms and to three-box3d.
 *
 * Slot semantics (frozen): bodies are INSERTION-ORDERED and the packed arrays are
 * compacted on rebuild. Removing a body RENUMBERS every body after it — slot
 * indices are NOT stable across rebuilds. Never cache an index or byte offset
 * across a rebuild; always resolve through `offsetOf(body)`.
 */
export class TransformBuffer {
  constructor(capacity?: number);
  /** Track a body (appended in insertion order). Marks dirty. */
  add(body: BodyHandle): void;
  /** Untrack a body. Marks dirty; the packed arrays compact (and later bodies
   *  renumber) on the next rebuild. */
  remove(body: BodyHandle): void;
  markDirty(): void;
  /** Rebuild the packed id array if dirty (call before readInto). */
  rebuild(): void;
  /** Read all tracked bodies' poses via the world, once per step. */
  readInto(world: World): void;
  /** Body → CURRENT 7-float offset into `transforms` (undefined if untracked).
   *  The only supported way to locate a body's floats — do not cache the result
   *  across rebuilds. */
  offsetOf(body: BodyHandle): number | undefined;
  readonly ids: Int32Array;        // packed, insertion-ordered, length = count
  readonly transforms: Float32Array; // 7*count floats
  readonly count: number;
}
```

#### `SleepManager`
```ts
/**
 * Island-aware sleep discipline. box3d sleeps ISLANDS, not bodies: waking one body
 * in a settled stack wakes the whole structure. So: force-sleep after settle, then
 * periodically sleep bodies that moved <threshold over the sweep interval.
 *
 * Buffer interaction: SleepManager resolves each body's pose via
 * `buffer.offsetOf(body)` on EVERY sweep — it never caches slot indices, because
 * TransformBuffer removal renumbers slots on rebuild (see TransformBuffer).
 */
export interface SleepManagerOptions {
  settleSteps?: number;       // steps to let a fresh spawn settle, default 2
  sweepIntervalSec?: number;  // periodic sweep cadence, default 2 s
  moveThreshold?: number;     // per-sweep displacement to still count as "moving", default 0.01 m
}
export class SleepManager {
  constructor(world: World, options?: SleepManagerOptions);
  /** Track bodies (their poses live in the given TransformBuffer). */
  watch(bodies: readonly BodyHandle[], buffer: TransformBuffer): void;
  /** Force-sleep freshly spawned tracked bodies after `settleSteps`. */
  forceSleepSettled(): void;
  /** Run the periodic <threshold sweep; no-op until the interval elapses. */
  sweep(simTime: number): void;
}
```

#### `radialImpulse`
```ts
/**
 * The explode workaround: native `b3World_Explode` is a NO-OP on sleeping bodies.
 * This wakes each in-range body and applies a falloff impulse with upward bias.
 * Reads poses from a TransformBuffer (no per-body query). Framework-agnostic.
 *
 * Exact math (frozen), per body at distance d ≤ radius from center:
 *   f        = 1 - d/radius                        // falloff factor, 0..1
 *   s        = strength * f²                       // 'quadratic' (default); 'linear' uses s = strength * f
 *   impulse  = normalize(bodyPos - center) * s     // radial direction (zero vector if d < 1mm)
 *   impulse.y += upwardBias * s                    // upward bias, fraction of the local strength
 *   wakeBody(body); applyImpulse(body, impulse, bodyPos)
 */
export interface RadialImpulseOptions {
  center: Vec3;
  radius: number;
  strength: number;             // peak impulse magnitude at center
  falloff?: 'linear' | 'quadratic'; // default 'quadratic'
  upwardBias?: number;          // fraction of local strength added on +Y, default 0
}
export function radialImpulse(
  world: World,
  bodies: readonly BodyHandle[],
  buffer: TransformBuffer,
  options: RadialImpulseOptions,
): void;
```

> **Doc-test note:** the unit tests reproduce both dogfood tunings against this
> formula — yardPhysics `boomAt` (`upwardBias: 0.28`) and playgroundPhysics
> `blastAt` (`strength: 8.5`, `upwardBias: 1.1`). Both MUST be exactly expressible
> via `RadialImpulseOptions`; any drift in the math is a breaking change.

#### `BodyPool` ⚠️ experimental — NOT frozen in v0.1
```ts
/**
 * ⚠️ EXPERIMENTAL (unfrozen): this API may change in v0.5 — in particular the
 * closure-based `spawn` may be revised. Everything else in this document is
 * frozen; BodyPool is the one exception.
 *
 * Capped pool of transient bodies (debris, projectiles). When over cap, destroys
 * the OLDEST. You supply the spawn fn; the pool owns lifetime + eviction.
 */
export class BodyPool {
  constructor(world: World, options: { max: number; onEvict?: (body: BodyHandle) => void });
  /** Spawn via your factory, register, and evict oldest if over cap. */
  spawn(create: (world: World) => BodyHandle): BodyHandle;
  destroyAll(): void;
  readonly bodies: readonly BodyHandle[];
}
```

#### `probeCapabilities`
```ts
/** Standalone probe (same result as `Box3D.capabilities()`), for callers holding
 *  only a World. Creates a throwaway probe body far off-scene, tests each optional
 *  export, cleans up. Cached per world. */
export function probeCapabilities(world: World): Capabilities;
```

### 2.12 Error handling conventions (frozen)

- **`createBox3D` rejects** (never resolves null) on WASM fetch/instantiate/link
  failure. The rejection message names the likely cause (missing env import, bad
  `wasmUrl`, wrong content-type).
- **Constructors / create* throw `TypeError`/`RangeError`** on programmer error
  (wrong typed-array kind, `out` too small, NaN where finite required after the
  loud path). Non-finite *option* fields silently fall back to documented defaults
  (matches the current `finiteOr` behavior — forgiving inputs, strict buffers).
- **Invalid handles are no-ops or return `0`/`-1`** at the bridge, mirroring
  box3d's slot semantics; they do NOT throw. Using a handle after `destroy*` is
  defined as a no-op, not UB.
- **`castRayClosest` returns `null`** on no hit — the one legitimate "nothing"
  result. Everything else that can fail throws or returns a sentinel count.
- Calling any `World` method after `destroy()` (or any method after
  `Box3D.dispose()`) throws `Error` with a "used after dispose" message.

### 2.13 Units & coordinate conventions (frozen, documented up front)

- **Right-handed, Y-up.** Same as three.js default.
- **Meters, kilograms, seconds.** Gravity default `[0, -9.81, 0]`.
- **Quaternions are `(x, y, z, w)`** — matches `THREE.Quaternion` component order,
  so no reorder crossing the boundary.
- **Angles in radians.** Joint limits, cones, twists.
- Transform buffer layout is fixed: `[x, y, z, qx, qy, qz, qw]` per body.

---

## 3. Consumer walkthrough — brick stack + InstancedMesh (README hero, embryo)

```ts
import { createBox3D, FixedStepper, TransformBuffer, SleepManager } from 'box3d-web';
import { writeTransformsToInstancedMesh } from 'three-box3d'; // adapter, separate pkg
import * as THREE from 'three';

const b3 = await createBox3D();                 // ← loud, explicit init
const world = b3.createWorld({ gravity: [0, -9.81, 0] });

// ground
const ground = world.createBody({ type: 'static' });
world.addBox(ground, [50, 0.5, 50], { friction: 0.8 });

// a 6x10 brick wall, tracked in one flat buffer
const buffer = new TransformBuffer(64);
const bricks: number[] = [];
for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 6; col++) {
    const body = world.createBody({
      type: 'dynamic',
      position: [col * 1.02 - 3, 0.5 + row * 0.52, 0],
    });
    world.addBox(body, [0.5, 0.25, 0.25], { density: 2, friction: 0.7 });
    bricks.push(body);
    buffer.add(body as any);
  }
}

// island-aware sleep so a settled wall costs ~0 step time
const sleep = new SleepManager(world, { sweepIntervalSec: 2, moveThreshold: 0.01 });
sleep.watch(bricks as any, buffer);

// three.js side (stubbed): one InstancedMesh, material with vertexColors:FALSE
const geo = new THREE.BoxGeometry(1, 0.5, 0.5);
const mat = new THREE.MeshStandardMaterial(); // NB: vertexColors must stay false → else black instances
const mesh = new THREE.InstancedMesh(geo, mat, bricks.length);

const stepper = new FixedStepper();             // 1/60, 4 substeps, 3-step death-spiral clamp

function frame(delta: number) {
  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);
    sleep.forceSleepSettled();
    sleep.sweep(stepper.simTime);
  });
  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);                     // one bulk read: 7 floats/body
    writeTransformsToInstancedMesh(mesh, buffer); // adapter does the matrix write (takes the whole buffer)
  }
}
// drive frame(delta) from your rAF / R3F useFrame loop — never setState per frame.
```

Reads top-to-bottom, ~40 lines, and the three shipping hazards (explicit `await`,
`vertexColors:false`, no per-frame setState) surface as inline comments — exactly the
hero sample's job.

---

## 4. Migration notes — `box3d-bridge.ts` → `box3d-web` v0.1

The Phase 3 dogfood port follows this table 1:1.

| Old (`box3d-bridge.ts`) | New (`box3d-web`) | Note |
|---|---|---|
| `initPhysics()` (singleton promise) | `await createBox3D()` | No singleton; hold the returned `Box3D`. |
| `createWorld({ gravityY })` | `b3.createWorld({ gravity: [0,g,0] })` | Full vector, not just Y. |
| `destroyWorld(w)` | `world.destroy()` | |
| `step(w, dt, substeps)` | `world.step(dt, substeps)` | Or drive via `FixedStepper`. |
| `createBody(w, {x,y,z,qx..})` | `world.createBody({ position, rotation })` | Tuples, not loose fields. |
| `destroyBody(id)` | `world.destroyBody(body)` | |
| `addBoxShape(id, {hx,hy,hz,..})` | `world.addBox(body, [hx,hy,hz], material)` | Half-extents as `Vec3`. |
| `addSphereShape` / `addCapsuleShape` | `world.addSphere` / `world.addCapsule` | |
| `addSensorBoxShape` | `world.addSensorBox` | |
| `applyImpulse(id, ix..,px..)` | `world.applyImpulse(body, impulse, at)` | |
| `setLinearVelocity` | `world.setLinearVelocity(body, v)` | |
| `getLinearVelocityOf` → `{x,y,z}` | `world.getLinearVelocity(body, out?)` | Optional reusable out-param. |
| — | `world.setAngularVelocity` / `getAngularVelocity` | **NEW** bridge export. |
| — | `world.applyForce` / `applyTorque` | **NEW** bridge export. |
| — | `world.setBodyTransform` | **NEW** bridge export. |
| `setBodyType` | `world.setBodyType` | |
| `wakeBody` / `sleepBody` | `world.wakeBody` / `sleepBody` (or `setAwake`) | |
| `awakeBodyCount(w)` / `bodyCount(w)` | `world.awakeBodyCount()` / `bodyCount()` | |
| `explode(...)` | `radialImpulse(world, bodies, buffer, opts)` | Helper replaces the native no-op path. |
| `castRayClosest(...)` → `{hit,bodyId,px..}` | `world.castRayClosest(o, d)` → `RaycastHit \| null` | `null` on miss. |
| `setKinematicTarget(id, x..,dt)` | `world.setKinematicTarget(body, pos, rot, dt)` | |
| `createSphericalJoint(w,a,b,anchor,opts)` | `world.createSphericalJoint(a,b,opts)` | `coneLimit`/`twistLimit` tuples; `spring` object. |
| `createRevoluteJoint(...)` | `world.createRevoluteJoint(a,b,opts)` | `axis`/`limit` tuple. |
| `createDistanceJointEx(...)` | `world.createDistanceJoint(a,b,opts)` | Drop the `Ex` — one canonical form. |
| — (drag hack: destroy hand body) | `world.destroyJoint(joint)` | **NEW** bridge export; retires the hack. |
| `readTransforms(ids, out)` | `world.readTransforms(ids, out)` or `TransformBuffer.readInto` | Same 7-float layout. |
| `drainContactBeginEvents(w)` | `world.drainContactBeginEvents()` | **RENAME:** event field `approxSpeed` → `approachSpeed`. |
| `drainSensorEvents(w)` | `world.drainSensorEvents()` | **RENAME:** event fields `{sensorBody, otherBody}` → `{sensor, other}`. |
| inline accumulator (yard/pg/cup) | `FixedStepper` | |
| inline `Int32Array`/`Float32Array` + dirty rebuild | `TransformBuffer` | |
| inline force-sleep + 2s sweep | `SleepManager` | |
| inline `blastAt` / `boomAt` | `radialImpulse` | |
| inline `MAX_BRICKS` destroy-oldest | `BodyPool` | |
| `YardCaps`/`PlaygroundCaps` try/catch probe | `probeCapabilities(world)` / `b3.capabilities()` | |

---

## 5. Explicitly out of scope for v0.1 (defer list, matches plan §3 table)

Deferred to **v0.5**:
- ~~Collision filters~~ — **the filter-joint slice shipped, see §7**; per-body/
  per-shape **user data** and query filters remain deferred.
- ~~More joints: motor~~ — **revolute + spherical joint motors shipped, see §7**;
  prismatic and weld joints remain deferred.
- Runtime **material updates** — shipped early in the v0.1 addendum (§6
  `setShapeFriction`/`setShapeRestitution`), ahead of this defer note.
- Allocation-free event streaming as the *recommended default* path (the `…Into`
  variants ship in v0.1, but the object-returning drain stays the documented default
  until v0.5).
- Raycast `normal` / `shape` / `fraction` fields (bridge returns only hit+body+point today).
- Multi-hit / shape-cast / overlap queries.
- DEV-only world-tagged handles that throw on cross-world misuse (see §2.2 footgun).
- `BodyPool` API freeze (experimental in v0.1; `spawn` shape may be revised).

Deferred to **v1.0**:
- Mesh / heightfield colliders; sensors beyond boxes.
- Cross-run / cross-platform **determinism CI guarantee** (v0.1 ships only the
  documented "single-thread, same-build reproducible" caveat).
- Multithread / SharedArrayBuffer build variant (COOP/COEP headers — post-1.0).

Out of the **core** package entirely (belongs to sibling packages, never in `box3d-web`):
- Any `three` import, `Object3D`/`InstancedMesh` sync → `three-box3d`.
- React hooks, `<Physics>` provider → `r3f-box3d`.

## 6. v0.1 addendum (bridge round 2)

Additive-only surface added after the frozen sign-off above. Existing signatures
were not changed; all new methods degrade gracefully via `Capabilities` on older
builds. Ground truth is `native/expected-exports.txt` (47 `b3bridge_*` + malloc/free).

- **Sensor-visitor fix (no new export).** `Bridge_MakeShapeDef` now sets
  `enableSensorEvents = true` on every regular (non-sensor) shape. box3d only
  emits a sensor begin/end event when the *visitor* shape has that flag set
  (`native/box3d/src/sensor.c:118`); previously no solid box/sphere/capsule shape
  could ever be detected by a sensor. Default-on (no bridge param) matches the
  old app's expectation and box2d v3 behavior.
- **`World.applyForce(body, force, at?)` — `at` now honored.** New export
  `b3bridge_applyForceAt` wraps `b3Body_ApplyForce` (world-space application
  point; imparts torque when off-center). Gated by `Capabilities.forceAtPoint`;
  without it (or when `at` is omitted) the existing center-of-mass
  `b3bridge_applyForce` path is used, unchanged.
- **`World.getBodyType(body)` / `World.isBodyAwake(body)`.** Wrap
  `b3Body_GetType` / `b3Body_IsAwake`. Gated by `Capabilities.bodyQueries`.
  `getBodyType` returns `null` for an invalid handle or an older build.
- **`World.setGravity([x, y, z])`.** Wraps `b3World_SetGravity` (full vector),
  changing the full gravity vector after world creation. Gated by
  `Capabilities.setGravity`.
- **`World.setShapeFriction(shape, friction)` / `World.setShapeRestitution(shape, restitution)`.**
  Wrap `b3Shape_SetFriction` / `b3Shape_SetRestitution`, addressed by the
  `ShapeHandle` already returned from `add*Shape`. Gated by
  `Capabilities.shapeMaterial`. This is the "runtime material updates" item
  from the v0.5 defer list in §5 — pulled forward because the upstream API is a
  trivial 1:1 wrapper.
- **Body inertia read/write.** `getBodyInertia` reads the local diagonal tensor;
  `setBodyInertia` replaces it with a positive finite diagonal while retaining
  the current mass and local center of mass. The write is gated independently by
  `Capabilities.setBodyInertia` for older WASM builds.
- **New `Capabilities` fields (add-only):** `forceAtPoint`, `bodyQueries`,
  `setGravity`, `shapeMaterial`, `bodyInertia`, `setBodyInertia`.

## 7. v0.5 addendum (joint motors + filter joint)

Additive-only surface, pulled forward from the v0.5 defer list in §5 ahead of a
full v0.5 cut: **solver-integrated joint motors** for the revolute and spherical
joints, and a **filter joint** for disabling collision between two arbitrary
bodies with no constraint. Existing v0.1 signatures are unchanged in spirit —
every joint-creation export grew new *trailing* parameters, so old call sites
that already pass every existing argument still compile; only callers using a
raw positional call through `Box3DExports` (not the `World` API) need to add
the new trailing args. Everything degrades gracefully via `Capabilities` on
older builds. Ground truth is `native/expected-exports.txt` (50 `b3bridge_*` +
malloc/free = 52).

Why this matters: an externally-applied torque impulse (`applyTorque`) is a
single one-shot kick each frame that the *caller* must recompute and reapply
every step, with no notion of a target speed or a torque budget — it's easy to
over- or under-drive, and nothing stops it from injecting unbounded energy. A
**solver-integrated motor** instead declares intent ("drive toward this speed,
using at most this much torque") once, and the constraint solver enforces the
torque clamp every substep while continuously correcting toward the target —
the textbook building block for an active ragdoll's joint drives.

- **`RevoluteJointOptions.motor?: { speed: number; maxTorque: number }`.**
  `speed` (rad/s) is the target angular speed about the hinge axis; `maxTorque`
  (N·m, clamped to ≥ 0) is the solver's per-substep torque budget while driving
  toward it. Omit for no motor (matches the v0.1 default — free spin or a
  passive limit, never a spurious drive).
- **`SphericalJointOptions.motor?: { velocity: Vec3; maxTorque: number }`.**
  `velocity` (rad/s) is the target angular velocity vector; `maxTorque` is the
  shared torque budget across all three axes. Omit for no motor.
- **`World.setRevoluteMotor(joint, opts | null)` / `World.setSphericalMotor(joint, opts | null)`.**
  Enable, retune, or disable (`null`) a joint's motor after creation — e.g. an
  active ragdoll continuously re-targeting its joint drives every frame from a
  controller, without recreating the joint. **Wakes the joint's bodies when
  enabling** (mirrors the documented "wakes the body" convention on
  `applyForce`/`applyImpulse` — a sleeping island is never stepped, so a motor
  enabled on a settled joint would otherwise silently do nothing until
  something else woke it). Disabling does not force a wake.
- **`World.createFilterJoint(a, b): JointHandle`.** A joint with **no
  constraint** — it only disables collision between `a` and `b` for as long as
  it exists (wraps `b3CreateFilterJoint`/`b3FilterJointDef`, which is exactly
  how box3d already implements `collideConnected` for every other joint type;
  this just exposes the bare mechanism with nothing else attached). Destroy via
  the existing `destroyJoint` to restore collision between the pair — no new
  destroy path. **Gotcha (native behavior, not a bridge bug):** the broad phase
  only re-evaluates a shape pair's collision filter while at least one of the
  two bodies is moving enough to re-trigger a broad-phase "moved proxy" check
  (`native/box3d/src/broad_phase.c`); two bodies at *rest* (zero velocity, e.g.
  settled to sleep) will not spontaneously re-discover each other after
  `destroyJoint` — nudge/wake them (a falling pair under gravity, or any body
  with nonzero velocity, re-triggers on the very next step with no extra call
  needed).
- **Runtime motor setters wrap already-shipped native API, not new engine
  code.** `b3RevoluteJoint_EnableMotor`/`SetMotorSpeed`/`SetMaxMotorTorque` and
  `b3SphericalJoint_EnableMotor`/`SetMotorVelocity`/`SetMaxMotorTorque` (and
  `b3CreateFilterJoint`/`b3DefaultFilterJointDef`) were already present in
  `native/box3d/include/box3d/box3d.h`; this addendum is the bridge + TS
  plumbing to reach them, not new physics.
- **New bridge exports:** `b3bridge_create_filter_joint`,
  `b3bridge_set_revolute_motor`, `b3bridge_set_spherical_motor`. The existing
  `b3bridge_create_revolute_joint` / `b3bridge_create_spherical_joint` exports
  grew trailing motor parameters (same export name, longer signature — see the
  compatibility note above).
- **New `Capabilities` fields (add-only):** `jointMotors` (creation-time
  `motor` option + both runtime setters), `filterJoint` (`createFilterJoint`).
