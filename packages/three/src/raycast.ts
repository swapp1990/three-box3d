/**
 * raycastFromCamera — build a world-space ray from a camera + NDC coordinates and
 * cast it against a box3d-web World in one call. This is the "click to pick" glue:
 * you still own turning a pointer/click DOM event into NDC (x, y in [-1, 1]) —
 * three.js's own `Raycaster.setFromCamera` does the same unprojection, so this
 * mirrors that convention rather than inventing a new one.
 */
import { Vector3, type Camera } from 'three';
import type { RaycastHit } from 'box3d-web';

/** Structural view of `box3d-web`'s World — only the one method this needs. */
export interface RaycastWorldLike {
  castRayClosest(origin: readonly [number, number, number], dir: readonly [number, number, number]): RaycastHit | null;
}

// Scratch reused across calls — this is typically a per-click, not per-frame,
// call, but keep it allocation-free for consistency with the rest of the adapter.
const scratchOrigin = new Vector3();
const scratchDir = new Vector3();

/**
 * Unproject `(ndcX, ndcY)` (each in `[-1, 1]`, matching `THREE.Raycaster`'s NDC
 * convention: -1..1 left-to-right, -1..1 bottom-to-top) through `camera`, cast the
 * resulting ray into `world` out to `maxDistance` meters, and return the closest
 * hit or `null`.
 *
 * box3d-web's `castRayClosest(origin, dir)` encodes the max distance in the
 * magnitude of `dir` (an unnormalized ray vector) rather than a separate
 * parameter — this function does that scaling for you.
 */
export function raycastFromCamera(
  world: RaycastWorldLike,
  camera: Camera,
  ndcX: number,
  ndcY: number,
  maxDistance = 1000,
): RaycastHit | null {
  camera.updateMatrixWorld();

  // Camera-space origin: perspective cameras ray from the eye; orthographic
  // cameras ray from the near-plane point under the cursor. unproject() handles
  // both correctly given the right starting z.
  scratchOrigin.set(ndcX, ndcY, -1).unproject(camera);
  scratchDir.set(ndcX, ndcY, 1).unproject(camera).sub(scratchOrigin).normalize();

  const origin: [number, number, number] = [scratchOrigin.x, scratchOrigin.y, scratchOrigin.z];
  const dir: [number, number, number] = [
    scratchDir.x * maxDistance,
    scratchDir.y * maxDistance,
    scratchDir.z * maxDistance,
  ];
  return world.castRayClosest(origin, dir);
}
