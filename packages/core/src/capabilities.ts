/**
 * Feature probing. box3d is pre-1.0 and the bridge may be recompiled with fewer
 * exports; helpers degrade gracefully on `false`. A probe creates a throwaway
 * body far off-scene, tests each optional export by calling it and watching for a
 * "not a function" throw, then cleans up. Result is cached per world.
 */
import type { Box3DModule } from './raw-module.js';
import type { BodyHandle, Capabilities, WorldHandle } from './types.js';
import type { WorldImpl } from './world.js';

function probe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

const cache = new WeakMap<WorldImpl, Capabilities>();

function makeCapabilities(fields: Omit<Capabilities, 'has'>): Capabilities {
  const record = fields as unknown as Record<string, boolean>;
  return {
    ...fields,
    has(feature: string): boolean {
      return record[feature] === true;
    },
  };
}

/**
 * Probe against a live module + world handle. Used by both `Box3D.capabilities()`
 * and the standalone `probeCapabilities(world)`.
 */
export function computeCapabilities(mod: Box3DModule, world: WorldImpl): Capabilities {
  const cached = cache.get(world);
  if (cached) return cached;

  const exp = mod.exports;
  const handle = world.handle as WorldHandle;

  // World-level probes: safe far-away arguments, no side effects on the scene.
  const explode = probe(() => exp.b3bridge_explode(handle, 0, -9000, 0, 0.01, 0, 0));
  const castRay = probe(() => {
    const ptr = mod.malloc(5 * 4);
    try {
      exp.b3bridge_cast_ray_closest(handle, 0, -9000, 0, 0, 1, 0, ptr);
    } finally {
      mod.free(ptr);
    }
  });
  const awakeBodyCount = probe(() => exp.b3bridge_get_awake_body_count(handle));
  const bodyCount = probe(() => exp.b3bridge_get_body_count(handle));

  const setGravity = probe(() => {
    const g = exp.b3bridge_setGravity(handle, 0, -9.81, 0);
    void g;
  });

  // Body-level probes need a real throwaway body far below the play area.
  let setBodyType = false;
  let getLinearVelocity = false;
  let angularVelocity = false;
  let forces = false;
  let forceAtPoint = false;
  let setAwake = false;
  let setBodyTransform = false;
  let bodyQueries = false;
  let shapeMaterial = false;

  let probeBody = 0;
  try {
    probeBody = exp.b3bridge_create_body(handle, 2, 0, -8800, 0, 0, 0, 0, 1, 0);
    if (probeBody) {
      const probeShape = exp.b3bridge_add_sphere_shape(probeBody, 0.1, 1, 0.6, 0);
      setBodyType = probe(() => exp.b3bridge_set_body_type(probeBody, 2));
      getLinearVelocity = probe(() => {
        const ptr = mod.malloc(3 * 4);
        try {
          exp.b3bridge_get_linear_velocity(probeBody, ptr);
        } finally {
          mod.free(ptr);
        }
      });
      angularVelocity = probe(() => {
        exp.b3bridge_setAngularVelocity(probeBody, 0, 0, 0);
        const ptr = mod.malloc(3 * 4);
        try {
          exp.b3bridge_getAngularVelocity(probeBody, ptr);
        } finally {
          mod.free(ptr);
        }
      });
      forces = probe(() => {
        exp.b3bridge_applyForce(probeBody, 0, 0, 0);
        exp.b3bridge_applyTorque(probeBody, 0, 0, 0);
      });
      forceAtPoint = probe(() => exp.b3bridge_applyForceAt(probeBody, 0, 0, 0, 0, -8800, 0));
      setAwake = probe(() => exp.b3bridge_set_awake(probeBody, 0));
      setBodyTransform = probe(() =>
        exp.b3bridge_setBodyTransform(probeBody, 0, -8800, 0, 0, 0, 0, 1),
      );
      bodyQueries = probe(() => {
        exp.b3bridge_getBodyType(probeBody);
        exp.b3bridge_isBodyAwake(probeBody);
      });
      shapeMaterial = probe(() => {
        exp.b3bridge_setShapeFriction(probeShape, 0.6);
        exp.b3bridge_setShapeRestitution(probeShape, 0);
      });
    }
  } finally {
    if (probeBody) exp.b3bridge_destroy_body(probeBody as BodyHandle);
  }

  const caps = makeCapabilities({
    awakeBodyCount,
    bodyCount,
    setAwake,
    setBodyType,
    getLinearVelocity,
    castRay,
    explode,
    angularVelocity,
    forces,
    setBodyTransform,
    forceAtPoint,
    bodyQueries,
    setGravity,
    shapeMaterial,
  });
  cache.set(world, caps);
  return caps;
}
