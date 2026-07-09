/**
 * Public value types, branded handles, and option shapes for box3d-web.
 *
 * Units & conventions (frozen — see docs/api-design.md §2.13):
 *   Right-handed, Y-up. Meters, kilograms, seconds. Gravity default [0,-9.81,0].
 *   Quaternions are (x, y, z, w) — matches THREE.Quaternion order. Angles in radians.
 *   Transform buffer layout is [x, y, z, qx, qy, qz, qw] per body.
 */

declare const brand: unique symbol;

/** Opaque handle to a world. Runtime value is the bridge integer. */
export type WorldHandle = number & { readonly [brand]: 'World' };
export type BodyHandle = number & { readonly [brand]: 'Body' };
export type ShapeHandle = number & { readonly [brand]: 'Shape' };
export type JointHandle = number & { readonly [brand]: 'Joint' };

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // (x,y,z,w)

/** Mutable out-param to avoid per-call allocation. */
export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

export type BodyType = 'static' | 'kinematic' | 'dynamic';

export interface WorldOptions {
  /** Gravity vector, m/s². Default `[0, -9.81, 0]`. */
  gravity?: Vec3;
  /** Enable body sleeping (island-level). Default `true`. */
  enableSleep?: boolean;
  /** Enable continuous collision globally. Default `true`. */
  enableContinuous?: boolean;
}

export interface BodyOptions {
  type?: BodyType; // default 'dynamic'
  position?: Vec3; // default [0,0,0]
  rotation?: Quat; // (x,y,z,w), default [0,0,0,1]
  /** Continuous collision (bullet) for this body. Default false. */
  ccd?: boolean;
}

/** Per-shape material. All optional; defaults match box3d/app conventions. */
export interface ShapeMaterial {
  density?: number; // default 1
  friction?: number; // default 0.6
  restitution?: number; // default 0
}

export interface SphericalJointOptions {
  anchor?: Vec3; // world anchor, default at bodyA origin
  coneLimit?: number; // radians; omit = unlimited
  twistLimit?: readonly [lower: number, upper: number]; // radians; omit = unlimited
  spring?: { hertz: number; dampingRatio?: number }; // dampingRatio default 0.7
}

export interface RevoluteJointOptions {
  anchor?: Vec3; // world anchor
  axis?: Vec3; // world hinge axis, default +Z
  limit?: readonly [lower: number, upper: number]; // radians; omit = free spin
}

export interface DistanceJointOptions {
  anchorA?: Vec3; // local to A, default origin
  anchorB?: Vec3; // local to B, default origin
  length?: number; // rest length, default current distance
  minLength?: number;
  maxLength?: number;
  spring?: { hertz: number; dampingRatio?: number };
  enableLimit?: boolean; // clamp to [minLength, maxLength]
}

export interface RaycastHit {
  body: BodyHandle;
  /** World hit point. Freshly allocated per call — NOT a reused scratch object. */
  point: Readonly<{ x: number; y: number; z: number }>;
}

export interface ContactBeginEvent {
  bodyA: BodyHandle;
  bodyB: BodyHandle;
  /** Approach speed at contact (m/s) — use for impact-scaled VFX/sound. */
  approachSpeed: number;
}

export interface SensorEvent {
  sensor: BodyHandle; // the sensor body
  other: BodyHandle; // the body that entered
}

/**
 * Which optional native probes this WASM build supports. ADD-ONLY across versions.
 */
export interface Capabilities {
  awakeBodyCount: boolean;
  bodyCount: boolean;
  setAwake: boolean;
  setBodyType: boolean;
  getLinearVelocity: boolean;
  castRay: boolean;
  explode: boolean;
  angularVelocity: boolean;
  forces: boolean;
  setBodyTransform: boolean;
  /** applyForce/applyImpulse honoring a world-space application point (not just
   *  center-of-mass) — bridge round 2. */
  forceAtPoint: boolean;
  /** getBodyType / isBodyAwake queries — bridge round 2. */
  bodyQueries: boolean;
  /** World.setGravity (full x,y,z vector) — bridge round 2. */
  setGravity: boolean;
  /** Per-shape setFriction/setRestitution — bridge round 2. */
  shapeMaterial: boolean;
  /** Open-ended probe for features added after these typings were published. */
  has(feature: string): boolean;
}

export const BODY_TYPE_TO_INT: Record<BodyType, number> = {
  static: 0,
  kinematic: 1,
  dynamic: 2,
};

export const INT_TO_BODY_TYPE: Record<number, BodyType> = {
  0: 'static',
  1: 'kinematic',
  2: 'dynamic',
};
