/**
 * r3f-box3d — React Three Fiber hooks for box3d.
 *
 * Thin, hooks-first, refs-and-buffers (no ECS, no per-frame setState). Nothing
 * here is required to be inside a `<Physics>` provider — the provider is an
 * optional convenience for a shared world. Physics owns transforms; visuals stay
 * in three.js.
 *
 * Quickstart (Suspense-gated init — "why is physics undefined" is the #1 support
 * question in every WASM physics lib):
 *
 *   function Scene() {
 *     const box3d = useBox3D();                 // suspends until WASM ready
 *     const world = useWorld(box3d, { gravity: [0, -9.81, 0] });
 *     // ...createBody, useTransformBuffer, useFixedStep, useInstancedTransforms
 *   }
 *   // <Canvas><Suspense fallback={null}><Scene /></Suspense></Canvas>
 */

// Module init (Suspense + non-suspending escape hatch).
export {
  useBox3D,
  useBox3DAsync,
  clearBox3DCache,
  type UseBox3DAsyncResult,
} from './useBox3D.js';

// World lifecycle (StrictMode-safe).
export { useWorld } from './useWorld.js';

// Fixed-step frame loop.
export { useFixedStep, type UseFixedStepOptions } from './useFixedStep.js';

// Transform buffer + InstancedMesh sync.
export { useTransformBuffer } from './useTransformBuffer.js';
export { useInstancedTransforms } from './useInstancedTransforms.js';

// Optional shared-world provider.
export {
  Physics,
  usePhysics,
  type PhysicsProps,
  type PhysicsContextValue,
} from './Physics.js';

// Re-export the core value helpers so a consumer can `import { ... } from 'r3f-box3d'`
// without also importing box3d-web directly for the common cases. Tree-shakeable.
export {
  FixedStepper,
  TransformBuffer,
  SleepManager,
  radialImpulse,
  BodyPool,
  probeCapabilities,
} from 'box3d-web';

// Re-export the core + adapter types most hook consumers need.
export type {
  Box3D,
  Box3DLoadOptions,
  World,
  WorldOptions,
  BodyHandle,
  BodyOptions,
  BodyType,
  ShapeHandle,
  ShapeMaterial,
  JointHandle,
  Capabilities,
  Vec3,
  Quat,
  FixedStepperOptions,
  SleepManagerOptions,
  RadialImpulseOptions,
} from 'box3d-web';
