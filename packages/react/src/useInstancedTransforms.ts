/**
 * useInstancedTransforms — bridge a `TransformBuffer` to a three.js `InstancedMesh`
 * ref. Returns a `sync()` function to call once per frame (from `onAfterFrame`),
 * which bulk-writes every tracked body's pose into the mesh's instance matrices
 * via three-box3d's `writeTransformsToInstancedMesh`. No `setState` — physics owns
 * transforms; visuals stay in three.js.
 *
 * ⚠️ The mesh's material must keep `vertexColors: false` (the default) if you also
 * call `mesh.setColorAt(...)` — otherwise every instance renders BLACK. This is
 * documented on `writeTransformsToInstancedMesh`; it bit three meshes in the
 * dogfood app.
 */
import { useCallback } from 'react';
import type { RefObject } from 'react';
import type { InstancedMesh } from 'three';
import {
  writeTransformsToInstancedMesh,
  type InstancedTransformBufferLike,
  type WriteTransformsOptions,
} from 'three-box3d';

/**
 * Return a stable `sync()` that writes `buffer` into the InstancedMesh at
 * `meshRef`. Call it from your frame loop when the sim advanced.
 *
 * ```tsx
 * const meshRef = useRef<THREE.InstancedMesh>(null);
 * const sync = useInstancedTransforms(meshRef, buffer);
 * useFixedStep(world, { onAfterFrame: (s) => { if (s) { buffer.readInto(world); sync(); } } });
 * // <instancedMesh ref={meshRef} args={[geo, mat, count]} />
 * ```
 *
 * @param meshRef ref to the InstancedMesh (may be `null` before mount — `sync()`
 *   is then a no-op).
 * @param buffer the `TransformBuffer` (or structurally compatible) to read from.
 * @param options forwarded to `writeTransformsToInstancedMesh` (`hide`,
 *   `startIndex`). Read live on each `sync()` call.
 * @returns `sync()` — writes all tracked instances and flags
 *   `instanceMatrix.needsUpdate`. Returns instances written (0 if the mesh is
 *   not mounted yet).
 */
export function useInstancedTransforms(
  meshRef: RefObject<InstancedMesh | null>,
  buffer: InstancedTransformBufferLike,
  options?: WriteTransformsOptions,
): () => number {
  return useCallback(() => {
    const mesh = meshRef.current;
    if (!mesh) return 0;
    return writeTransformsToInstancedMesh(mesh, buffer, options);
  }, [meshRef, buffer, options]);
}
