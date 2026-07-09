import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { raycastFromCamera, type RaycastWorldLike } from '../src/raycast.js';

describe('raycastFromCamera', () => {
  it('builds a ray through the camera at NDC center and forwards it to castRayClosest', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const world: RaycastWorldLike = {
      castRayClosest: vi.fn().mockReturnValue({ body: 42, point: { x: 0, y: 0, z: 0 } }),
    };

    const hit = raycastFromCamera(world, camera, 0, 0, 100);

    expect(world.castRayClosest).toHaveBeenCalledTimes(1);
    const [origin, dir] = (world.castRayClosest as ReturnType<typeof vi.fn>).mock.calls[0] as [
      readonly [number, number, number],
      readonly [number, number, number],
    ];

    // Origin should be near the camera position (center of frame, near plane).
    expect(origin[2]).toBeGreaterThan(9);
    // Looking down -Z from (0,0,10) toward the origin: direction should point -Z,
    // and its magnitude should equal maxDistance (100).
    expect(dir[2]).toBeLessThan(0);
    const length = Math.hypot(dir[0], dir[1], dir[2]);
    expect(length).toBeCloseTo(100, 0);

    expect(hit).toEqual({ body: 42, point: { x: 0, y: 0, z: 0 } });
  });

  it('returns null when castRayClosest reports no hit', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
    const world: RaycastWorldLike = { castRayClosest: vi.fn().mockReturnValue(null) };

    expect(raycastFromCamera(world, camera, 0.3, -0.2)).toBeNull();
  });
});
