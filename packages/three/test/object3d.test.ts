import { describe, expect, it } from 'vitest';
import { Object3D, Quaternion } from 'three';
import { applyTransformToObject3D, type TransformBufferLike } from '../src/object3d.js';

function makeBuffer(entries: Array<{ body: number; pose: number[] }>): TransformBufferLike {
  const offsets = new Map<number, number>();
  const transforms = new Float32Array(entries.length * 7);
  entries.forEach(({ body, pose }, i) => {
    offsets.set(body, i * 7);
    transforms.set(pose, i * 7);
  });
  return {
    offsetOf: (body) => offsets.get(body),
    transforms,
  };
}

describe('applyTransformToObject3D', () => {
  it('copies position and quaternion from the 7-float layout', () => {
    const buffer = makeBuffer([
      { body: 1, pose: [1, 2, 3, 0, 0, 0, 1] },
      { body: 2, pose: [4, 5, 6, 0.5, 0.5, 0.5, 0.5] },
    ]);
    const obj = new Object3D();

    const applied = applyTransformToObject3D(obj, buffer, 2);

    expect(applied).toBe(true);
    expect(obj.position.x).toBe(4);
    expect(obj.position.y).toBe(5);
    expect(obj.position.z).toBe(6);
    const q = new Quaternion(0.5, 0.5, 0.5, 0.5);
    expect(obj.quaternion.x).toBeCloseTo(q.x);
    expect(obj.quaternion.y).toBeCloseTo(q.y);
    expect(obj.quaternion.z).toBeCloseTo(q.z);
    expect(obj.quaternion.w).toBeCloseTo(q.w);
  });

  it('returns false and leaves the object untouched when the body is untracked', () => {
    const buffer = makeBuffer([{ body: 1, pose: [1, 2, 3, 0, 0, 0, 1] }]);
    const obj = new Object3D();
    obj.position.set(9, 9, 9);

    const applied = applyTransformToObject3D(obj, buffer, 999);

    expect(applied).toBe(false);
    expect(obj.position.x).toBe(9);
  });
});
