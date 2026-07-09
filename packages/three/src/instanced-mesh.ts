/**
 * writeTransformsToInstancedMesh — bulk-write a TransformBuffer into an
 * InstancedMesh's per-instance matrices. One draw call for thousands of bodies;
 * this is the reason box3d-web's read path is a flat Float32Array and not a
 * per-body object.
 *
 * ⚠️ **`vertexColors: false` or you get BLACK instances.** If you also call
 * `mesh.setColorAt(...)` to tint instances, the material must NOT set
 * `vertexColors: true` unless you *also* supply a per-vertex color attribute on the
 * geometry. With `vertexColors: true` and no color attribute, three.js silently
 * multiplies every instance's color by black — this exact bug hit three separate
 * meshes in the dogfood app (crowd, intro letters, fan balls) before the rule was
 * written down. `setColorAt` alone (via `InstancedMesh.instanceColor`) works fine
 * with the DEFAULT `vertexColors: false` — leave it false.
 *
 *   const mat = new THREE.MeshStandardMaterial(); // vertexColors stays false
 *   mesh.setColorAt(i, color); // fine — instanceColor, not vertex colors
 */
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';

/** Structural view of `box3d-web`'s TransformBuffer used by the bulk writer. */
export interface TransformBufferLike {
  readonly ids: Int32Array;
  readonly transforms: Float32Array;
  readonly count: number;
}

export interface WriteTransformsOptions {
  /**
   * Return `true` to hide this instance for this write (e.g. a pooled/inactive
   * body, or a body evicted from a BodyPool but the mesh slot is still reserved).
   * Hidden instances get the sentinel zero-scale matrix from
   * `hiddenInstanceMatrix()` instead of their live pose — they render nothing and
   * don't participate in the (cheap, CPU-side) instance bounding math.
   */
  hide?: (body: number, index: number) => boolean;
  /**
   * Instance index to start writing at, default 0. Combine with a `mesh.count`
   * you've already sized to cover ids beyond `buffer.count` (e.g. a fixed-size
   * pool mesh where unused slots are hidden) — this function only ever touches
   * `[startIndex, startIndex + buffer.count)`.
   */
  startIndex?: number;
}

// Scratch reused across calls — this function is a per-frame hot path.
const scratchPos = new Vector3();
const scratchQuat = new Quaternion();
const scratchMatrix = new Matrix4();

/**
 * A matrix that scales an instance to zero, parking it off-screen. Use this to
 * hide an InstancedMesh slot that has no corresponding live body (a pooled slot
 * not yet spawned into, or a body temporarily excluded via `opts.hide`).
 * Zero-scale (not just a moved-away position) also collapses the instance's
 * contribution to `computeBoundingSphere`/raycasting to a single point.
 */
export function hiddenInstanceMatrix(target = new Matrix4()): Matrix4 {
  return target.makeScale(0, 0, 0);
}

/**
 * Bulk-write every body tracked in `buffer` into `mesh`'s instance matrices and
 * flag `instanceMatrix.needsUpdate`. Does not touch `mesh.count` — set that
 * yourself if the tracked body count changes (matches the InstancedMesh contract:
 * changing `count` is the caller's decision, not something a sync helper should
 * do silently).
 *
 * @param mesh three.js InstancedMesh to write into. Must have room for
 *   `startIndex + buffer.count` instances.
 * @param buffer a box3d-web TransformBuffer (or structurally compatible object).
 * @returns the number of instances written (excludes hidden ones, which still get
 *   the sentinel matrix but are reported separately isn't needed — same count).
 */
export function writeTransformsToInstancedMesh(
  mesh: InstancedMesh,
  buffer: TransformBufferLike,
  options: WriteTransformsOptions = {},
): number {
  const { ids, transforms, count } = buffer;
  const startIndex = options.startIndex ?? 0;
  const hide = options.hide;

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const body = ids[i];

    if (hide?.(body, index)) {
      hiddenInstanceMatrix(scratchMatrix);
      mesh.setMatrixAt(index, scratchMatrix);
      continue;
    }

    const offset = i * 7;
    scratchPos.set(transforms[offset], transforms[offset + 1], transforms[offset + 2]);
    scratchQuat.set(
      transforms[offset + 3],
      transforms[offset + 4],
      transforms[offset + 5],
      transforms[offset + 6],
    );
    scratchMatrix.compose(scratchPos, scratchQuat, ONE);
    mesh.setMatrixAt(index, scratchMatrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  return count;
}

const ONE = new Vector3(1, 1, 1);
