/**
 * Low-level typed surface of the box3d WASM module.
 *
 * These are the raw Emscripten-style exports (leading `_`, integer handles, flat
 * float/pointer args) exactly as the WASM bridge (`native/bridge.c`) presents them.
 * The high-level `World` API in `index.ts` is the thing consumers use; this file is
 * the contract between the loader and that API, and the single place export
 * signatures are pinned.
 *
 * Ground truth for the export list is `native/expected-exports.txt` (31 exports:
 * 29 `b3bridge_*` + `_malloc`/`_free`). Shape-add functions return `int` (a
 * ShapeHandle), NOT void — this was a documented bug in the old repo's `.d.ts`.
 *
 * Pointers are WASM linear-memory byte offsets (`number`). All floats are f32 on
 * the C side; JS passes `number`.
 */

/** WASM linear-memory byte offset. */
export type Ptr = number;

export interface Box3DExports {
  readonly memory: WebAssembly.Memory;

  /** Emscripten static-ctor init. This artifact exports `__wasm_call_ctors`
   *  (DECLARE_ASM_MODULE_EXPORTS=0 build); `_initialize` is only present in a
   *  STANDALONE_WASM build. The loader calls whichever exists. */
  __wasm_call_ctors?: () => void;
  _initialize?: () => void;

  malloc(size: number): Ptr;
  free(ptr: Ptr): void;

  // --- world lifecycle ---
  b3bridge_create_world(gravityY: number): number;
  b3bridge_destroy_world(worldHandle: number): void;
  b3bridge_step(worldHandle: number, dt: number, substeps: number): void;

  // --- bodies ---
  b3bridge_create_body(
    worldHandle: number,
    type: number,
    x: number, y: number, z: number,
    qx: number, qy: number, qz: number, qw: number,
    ccd: number,
  ): number;
  b3bridge_destroy_body(bodyHandle: number): void;
  b3bridge_set_body_type(bodyHandle: number, type: number): void;
  b3bridge_setBodyTransform(
    bodyHandle: number,
    x: number, y: number, z: number,
    qx: number, qy: number, qz: number, qw: number,
  ): void;

  // --- shapes (return a ShapeHandle int) ---
  b3bridge_add_box_shape(
    bodyHandle: number,
    hx: number, hy: number, hz: number,
    density: number, friction: number, restitution: number,
  ): number;
  b3bridge_add_sphere_shape(
    bodyHandle: number,
    radius: number,
    density: number, friction: number, restitution: number,
  ): number;
  b3bridge_add_capsule_shape(
    bodyHandle: number,
    radius: number, halfHeight: number,
    density: number, friction: number, restitution: number,
  ): number;
  b3bridge_add_sensor_box_shape(bodyHandle: number, hx: number, hy: number, hz: number): number;

  // --- velocities / forces / impulses ---
  b3bridge_apply_impulse(
    bodyHandle: number,
    ix: number, iy: number, iz: number,
    px: number, py: number, pz: number,
  ): void;
  b3bridge_set_linear_velocity(bodyHandle: number, vx: number, vy: number, vz: number): void;
  b3bridge_get_linear_velocity(bodyHandle: number, outVelocity: Ptr): void;
  b3bridge_setAngularVelocity(bodyHandle: number, x: number, y: number, z: number): void;
  b3bridge_getAngularVelocity(bodyHandle: number, outVelocity: Ptr): void;
  /** Force applied at center of mass only — the bridge uses ApplyForceToCenter
   *  and ignores any application point (no `at` args on the C side). */
  b3bridge_applyForce(bodyHandle: number, fx: number, fy: number, fz: number): void;
  b3bridge_applyTorque(bodyHandle: number, tx: number, ty: number, tz: number): void;
  b3bridge_set_kinematic_target(
    bodyHandle: number,
    x: number, y: number, z: number,
    qx: number, qy: number, qz: number, qw: number,
    dt: number,
  ): void;

  // --- joints ---
  b3bridge_create_spherical_joint(
    worldHandle: number, bodyHandleA: number, bodyHandleB: number,
    ax: number, ay: number, az: number,
    enableConeLimit: number, coneAngle: number,
    enableTwistLimit: number, lowerTwistAngle: number, upperTwistAngle: number,
    springHertz: number, springDampingRatio: number,
  ): number;
  b3bridge_create_revolute_joint(
    worldHandle: number, bodyHandleA: number, bodyHandleB: number,
    ax: number, ay: number, az: number,
    hx: number, hy: number, hz: number,
    enableLimit: number, lower: number, upper: number,
  ): number;
  b3bridge_create_distance_joint_ex(
    worldHandle: number, bodyHandleA: number, bodyHandleB: number,
    anchorAx: number, anchorAy: number, anchorAz: number,
    anchorBx: number, anchorBy: number, anchorBz: number,
    length: number, minLength: number, maxLength: number,
    enableSpring: number, hertz: number, dampingRatio: number,
    enableLimit: number,
  ): number;
  b3bridge_destroyJoint(jointHandle: number): void;

  // --- queries ---
  /** Writes 5 floats to `outHit`: [hit(0/1), bodyHandle, px, py, pz]. */
  b3bridge_cast_ray_closest(
    worldHandle: number,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    outHit: Ptr,
  ): void;

  // --- explode (present but no-ops on sleeping bodies — see radialImpulse) ---
  b3bridge_explode(
    worldHandle: number,
    x: number, y: number, z: number,
    radius: number, falloff: number, impulsePerArea: number,
  ): void;

  // --- sleep / counters ---
  b3bridge_set_awake(bodyHandle: number, awake: number): void;
  b3bridge_get_awake_body_count(worldHandle: number): number;
  b3bridge_get_body_count(worldHandle: number): number;

  // --- bulk read ---
  b3bridge_read_transforms(bodyHandlesPtr: Ptr, count: number, outTransformsPtr: Ptr): void;

  // --- events (return total accumulated count; may exceed capacity) ---
  b3bridge_drain_contact_begin_events(worldHandle: number, outEvents: Ptr, capacity: number): number;
  b3bridge_drain_sensor_events(worldHandle: number, outEvents: Ptr, capacity: number): number;
}

/**
 * The loaded module: raw exports plus fresh-per-access HEAP views (correct under
 * ALLOW_MEMORY_GROWTH — a cached view detaches when memory grows).
 */
export interface Box3DModule {
  readonly exports: Box3DExports;
  readonly memory: WebAssembly.Memory;
  malloc(size: number): Ptr;
  free(ptr: Ptr): void;
  /** Fresh Int8Array over current memory. */
  readonly HEAP8: Int8Array;
  readonly HEAPU8: Uint8Array;
  readonly HEAP32: Int32Array;
  readonly HEAPU32: Uint32Array;
  readonly HEAPF32: Float32Array;
}
