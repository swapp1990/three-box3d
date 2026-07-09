/**
 * toVec3 — convert a THREE.Vector3 into a box3d-web `Vec3` tuple `[x, y, z]`.
 * The core package never imports `three`, so every boundary crossing goes through
 * a plain tuple; this is the one-line adapter for the common case (a position,
 * an impulse direction, a raycast origin, ...).
 */
import type { Vector3 } from 'three';

/** A readonly 3-tuple matching box3d-web's `Vec3` (avoids a hard dep on the
 *  `box3d-web` package just for this type). */
export type Vec3 = readonly [number, number, number];

export function toVec3(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}
