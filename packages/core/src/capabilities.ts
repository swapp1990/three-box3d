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
  let bodyInertia = false;
  let setBodyInertia = false;
  let jointMotors = false;
  let filterJoint = false;

  let probeBody = 0;
  let probeBodyB = 0;
  try {
    probeBody = exp.b3bridge_create_body(handle, 2, 0, -8800, 0, 0, 0, 0, 1, 0, 0, 0, 1);
    probeBodyB = exp.b3bridge_create_body(handle, 2, 0, -8802, 0, 0, 0, 0, 1, 0, 0, 0, 1);
    if (probeBodyB) exp.b3bridge_add_sphere_shape(probeBodyB, 0.1, 1, 0.6, 0, 0);
    if (probeBody) {
      const probeShape = exp.b3bridge_add_sphere_shape(probeBody, 0.1, 1, 0.6, 0, 0);
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
      bodyInertia = probe(() => {
        const ptr = mod.malloc(3 * 4);
        try {
          exp.b3bridge_getBodyInertia(probeBody, ptr);
        } finally {
          mod.free(ptr);
        }
      });
      setBodyInertia = probe(() => {
        const ptr = mod.malloc(3 * 4);
        try {
          exp.b3bridge_getBodyInertia(probeBody, ptr);
          const heap = mod.HEAPF32;
          const index = ptr >> 2;
          exp.b3bridge_setBodyInertia(
            probeBody,
            heap[index], heap[index + 1], heap[index + 2],
          );
        } finally {
          mod.free(ptr);
        }
      });
      if (probeBodyB) {
        // Joint motors (v0.5): create a throwaway revolute + spherical joint
        // between the two probe bodies, exercise the creation-time motor params
        // AND the runtime setter, then tear down.
        jointMotors = probe(() => {
          const revJoint = exp.b3bridge_create_revolute_joint(
            handle,
            probeBody,
            probeBodyB,
            0, -8800, 0,
            0, 0, 1,
            0, 0, 0,
            1, 1, 10,
          );
          if (!revJoint) throw new Error('no revolute joint');
          exp.b3bridge_set_revolute_motor(revJoint, 1, 2, 20);
          exp.b3bridge_destroyJoint(revJoint);

          const sphJoint = exp.b3bridge_create_spherical_joint(
            handle,
            probeBody,
            probeBodyB,
            0, -8800, 0,
            0, 0,
            0, 0, 0,
            0, 0.7,
            1, 0, 1, 0, 10,
          );
          if (!sphJoint) throw new Error('no spherical joint');
          exp.b3bridge_set_spherical_motor(sphJoint, 1, 0, 2, 0, 20);
          exp.b3bridge_destroyJoint(sphJoint);
        });
        // Filter joint (v0.5): create + destroy a throwaway filter joint.
        filterJoint = probe(() => {
          const joint = exp.b3bridge_create_filter_joint(handle, probeBody, probeBodyB);
          if (!joint) throw new Error('no filter joint');
          exp.b3bridge_destroyJoint(joint);
        });
      }
    }
  } finally {
    if (probeBody) exp.b3bridge_destroy_body(probeBody as BodyHandle);
    if (probeBodyB) exp.b3bridge_destroy_body(probeBodyB as BodyHandle);
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
    bodyInertia,
    setBodyInertia,
    jointMotors,
    filterJoint,
  });
  cache.set(world, caps);
  return caps;
}
