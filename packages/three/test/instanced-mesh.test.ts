import { describe, expect, it } from 'vitest';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { hiddenInstanceMatrix, writeTransformsToInstancedMesh, type TransformBufferLike } from '../src/instanced-mesh.js';

function makeBuffer(poses: Array<{ id: number; pose: number[] }>): TransformBufferLike {
  const ids = new Int32Array(poses.map((p) => p.id));
  const transforms = new Float32Array(poses.length * 7);
  poses.forEach(({ pose }, i) => transforms.set(pose, i * 7));
  return { ids, transforms, count: poses.length };
}

function readMatrix(mesh: InstancedMesh, index: number): Matrix4 {
  const m = new Matrix4();
  mesh.getMatrixAt(index, m);
  return m;
}

describe('writeTransformsToInstancedMesh', () => {
  it('writes position + quaternion (scale 1) for each tracked body', () => {
    const buffer = makeBuffer([
      { id: 10, pose: [1, 0, 0, 0, 0, 0, 1] },
      { id: 11, pose: [0, 2, 0, 0, 0.7071068, 0, 0.7071068] },
    ]);
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 2);

    const versionBefore = mesh.instanceMatrix.version;
    const written = writeTransformsToInstancedMesh(mesh, buffer);

    expect(written).toBe(2);
    // `needsUpdate` is a write-only setter that bumps `.version` — assert the
    // observable effect instead of reading the (always-undefined) flag back.
    expect(mesh.instanceMatrix.version).toBeGreaterThan(versionBefore);

    const expected0 = new Matrix4().compose(
      new Vector3(1, 0, 0),
      new Quaternion(0, 0, 0, 1),
      new Vector3(1, 1, 1),
    );
    expect(readMatrix(mesh, 0).elements).toEqual(
      expect.arrayContaining(expected0.elements.map((v) => expect.closeTo(v, 5))),
    );

    const pos1 = new Vector3();
    const quat1 = new Quaternion();
    const scale1 = new Vector3();
    readMatrix(mesh, 1).decompose(pos1, quat1, scale1);
    expect(pos1.y).toBeCloseTo(2);
    expect(scale1.x).toBeCloseTo(1);
    expect(scale1.y).toBeCloseTo(1);
    expect(scale1.z).toBeCloseTo(1);
  });

  it('applies the hidden sentinel (zero-scale) matrix when opts.hide returns true', () => {
    const buffer = makeBuffer([
      { id: 1, pose: [0, 0, 0, 0, 0, 0, 1] },
      { id: 2, pose: [5, 5, 5, 0, 0, 0, 1] },
    ]);
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 2);

    writeTransformsToInstancedMesh(mesh, buffer, { hide: (body) => body === 2 });

    // Matrix4.decompose() can't reliably recover a zero scale (basis-vector
    // length collapses to 0 and its sign-detection logic reports 1 back) — so
    // assert on the raw matrix elements, which is what setColorAt/InstancedMesh
    // rendering actually reads.
    expect(readMatrix(mesh, 1).equals(hiddenInstanceMatrix())).toBe(true);

    const scaleVisible = new Vector3();
    readMatrix(mesh, 0).decompose(new Vector3(), new Quaternion(), scaleVisible);
    expect(scaleVisible.x).toBe(1);
  });

  it('respects startIndex, only touching [startIndex, startIndex + count)', () => {
    const buffer = makeBuffer([{ id: 1, pose: [3, 3, 3, 0, 0, 0, 1] }]);
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 3);
    // pre-fill slot 0 with a sentinel we can detect was left alone
    mesh.setMatrixAt(0, hiddenInstanceMatrix());

    writeTransformsToInstancedMesh(mesh, buffer, { startIndex: 1 });

    expect(readMatrix(mesh, 0).equals(hiddenInstanceMatrix())).toBe(true); // untouched, still hidden

    const pos1 = new Vector3();
    readMatrix(mesh, 1).decompose(pos1, new Quaternion(), new Vector3());
    expect(pos1.x).toBeCloseTo(3);
  });
});

describe('hiddenInstanceMatrix', () => {
  it('produces a matrix with a zero-scale linear part (matches Matrix4.makeScale(0,0,0))', () => {
    const m = hiddenInstanceMatrix();
    expect(m.equals(new Matrix4().makeScale(0, 0, 0))).toBe(true);
  });
});
