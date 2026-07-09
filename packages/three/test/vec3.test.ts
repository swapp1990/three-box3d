import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { toVec3 } from '../src/vec3.js';

describe('toVec3', () => {
  it('converts a THREE.Vector3 into a plain [x,y,z] tuple', () => {
    const v = new Vector3(1.5, -2, 3.25);
    expect(toVec3(v)).toEqual([1.5, -2, 3.25]);
  });
});
