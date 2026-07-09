/**
 * Optional `<Physics>` provider — the @react-three/rapier-style convenience layer
 * for a SHARED world. Children read the world/module/stepper via `usePhysics()`.
 *
 * This is entirely optional: every hook (`useBox3D`, `useWorld`, `useFixedStep`,
 * `useTransformBuffer`, `useInstancedTransforms`) works standalone with no
 * provider. Reach for `<Physics>` only when several sibling components share one
 * world and you'd rather not thread it through props.
 *
 * `<Physics>` calls `useBox3D()` internally, so it SUSPENDS until the WASM loads —
 * wrap it in `<Suspense>`. It creates one `useWorld` and drives one `useFixedStep`
 * for the whole subtree; per-frame stepping happens here, once.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Box3D, World, WorldOptions } from 'box3d-web';
import type { FixedStepper } from 'box3d-web';
import { useBox3D } from './useBox3D.js';
import { useWorld } from './useWorld.js';
import { useFixedStep, type UseFixedStepOptions } from './useFixedStep.js';

/** Value exposed by `<Physics>` to its subtree via `usePhysics()`. */
export interface PhysicsContextValue {
  /** The loaded module. */
  box3d: Box3D;
  /** The shared world for this subtree. */
  world: World;
  /** The fixed-step driver (for `simTime` / `reset`). `null` on the very first
   *  render before the stepper effect runs. */
  stepper: FixedStepper | null;
}

const PhysicsContext = createContext<PhysicsContextValue | null>(null);

export interface PhysicsProps {
  children?: ReactNode;
  /** World options for the shared world (gravity, sleep, continuous). */
  world?: WorldOptions;
  /** Fixed-step options — cadence + per-step / per-frame callbacks + pause. */
  step?: UseFixedStepOptions;
}

/**
 * Provide a shared box3d world to descendants. Suspends until the module loads.
 *
 * ```tsx
 * <Suspense fallback={<Loading />}>
 *   <Physics world={{ gravity: [0, -9.81, 0] }}>
 *     <Bricks />
 *   </Physics>
 * </Suspense>
 * ```
 */
export function Physics({ children, world: worldOptions, step }: PhysicsProps): ReactNode {
  const box3d = useBox3D(); // suspends until ready
  const world = useWorld(box3d, worldOptions);
  const stepper = useFixedStep(world, step);

  const value = useMemo<PhysicsContextValue | null>(
    () => (world ? { box3d, world, stepper } : null),
    [box3d, world, stepper],
  );

  return value ? (
    <PhysicsContext.Provider value={value}>{children}</PhysicsContext.Provider>
  ) : null;
}

/**
 * Read the shared physics context provided by an ancestor `<Physics>`. Throws if
 * called outside a `<Physics>` — that error is the signal to either add the
 * provider or use the standalone hooks (`useWorld` etc.) instead.
 */
export function usePhysics(): PhysicsContextValue {
  const ctx = useContext(PhysicsContext);
  if (!ctx) {
    throw new Error(
      'r3f-box3d: usePhysics() must be called inside a <Physics> provider. ' +
        'Either wrap the tree in <Physics>, or use the standalone hooks ' +
        '(useBox3D / useWorld / useFixedStep) without a provider.',
    );
  }
  return ctx;
}
