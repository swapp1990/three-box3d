/**
 * applyTransformToObject3D — copy one body's pose out of a TransformBuffer into a
 * plain three.js Object3D (mesh, group, camera target, whatever). Cheap enough to
 * call every frame for a handful of tracked objects; for hundreds/thousands of
 * instances use `writeTransformsToInstancedMesh` instead (one draw call, no
 * per-object JS allocation).
 */
import type { Object3D } from 'three';

/** Structural view of `box3d-web`'s TransformBuffer — avoids a hard dependency so
 *  this module only needs the two members it actually reads. */
export interface TransformBufferLike {
  offsetOf(body: number): number | undefined;
  readonly transforms: Float32Array;
}

/**
 * Read `body`'s pose from `buffer` (7-float layout: [x,y,z, qx,qy,qz,qw]) and apply
 * it to `obj.position` / `obj.quaternion`. No-op (returns `false`) if the body isn't
 * tracked in the buffer — e.g. it was destroyed or hasn't been added yet.
 *
 * @returns `true` if the transform was applied, `false` if `body` has no offset.
 */
export function applyTransformToObject3D(
  obj: Object3D,
  buffer: TransformBufferLike,
  body: number,
): boolean {
  const offset = buffer.offsetOf(body);
  if (offset === undefined) return false;
  const t = buffer.transforms;
  obj.position.set(t[offset], t[offset + 1], t[offset + 2]);
  obj.quaternion.set(t[offset + 3], t[offset + 4], t[offset + 5], t[offset + 6]);
  return true;
}
