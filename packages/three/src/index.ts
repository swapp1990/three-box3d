/**
 * three-box3d — the flagship three.js adapter for box3d-web.
 *
 * `box3d-web` never imports `three`; this package is the boundary. It copies
 * flat transform-buffer floats into `Object3D`/`InstancedMesh`, and back out for
 * raycasting — nothing here owns simulation state.
 *
 * `three` is a peer dependency (`>=0.159`); `box3d-web` is a regular dependency.
 */
export { applyTransformToObject3D, type TransformBufferLike as ObjectTransformBufferLike } from './object3d.js';
export {
  writeTransformsToInstancedMesh,
  hiddenInstanceMatrix,
  type TransformBufferLike as InstancedTransformBufferLike,
  type WriteTransformsOptions,
} from './instanced-mesh.js';
export { toVec3, type Vec3 } from './vec3.js';
export { raycastFromCamera, type RaycastWorldLike } from './raycast.js';
