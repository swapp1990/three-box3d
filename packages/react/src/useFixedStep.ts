/**
 * useFixedStep — drive a `World` on a fixed-timestep accumulator from R3F's frame
 * loop. Wraps `box3d-web`'s `FixedStepper` (1/60, 4 substeps, death-spiral guard)
 * inside `useFrame` so the sim advances in deterministic increments regardless of
 * display refresh rate.
 *
 * The default per-step behavior is `world.step(fixedDt, substeps)`. Pass `onStep`
 * to add work that must run at the SAME cadence as the physics step (sleep sweeps,
 * per-step event drains) — it runs after the world step for each fixed increment.
 * Pass `onAfterFrame(stepped)` for once-per-rendered-frame work that should only
 * run when the sim actually advanced (buffer read + InstancedMesh sync) — this is
 * where the transform read belongs, NOT inside `onStep`.
 *
 * All callbacks are stored in a ref, so you can pass fresh closures every render
 * without re-subscribing the frame loop. Nothing here calls `setState`.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { FixedStepper, type FixedStepperOptions, type World } from 'box3d-web';

export interface UseFixedStepOptions extends FixedStepperOptions {
  /**
   * Extra work at the fixed-step cadence, run AFTER `world.step` for each fixed
   * increment. `dt` is the fixed step (not the frame delta); `simTime` is the
   * stepper's monotone simulated time. Use for sleep sweeps / per-step drains.
   */
  onStep?: (dt: number, simTime: number) => void;
  /**
   * Once-per-rendered-frame work. `stepped` is how many fixed steps ran this frame
   * (0 = the sim didn't advance, so skip the transform sync). Use for the bulk
   * transform read + InstancedMesh write.
   */
  onAfterFrame?: (stepped: number) => void;
  /**
   * R3F render priority for the frame loop. Default 0. Set a positive number to
   * take over the loop (e.g. when you also manually render), matching useFrame.
   */
  priority?: number;
  /** Pause stepping without unmounting. Default false. */
  paused?: boolean;
}

/**
 * Step `world` every frame on a fixed accumulator. Returns the `FixedStepper` (for
 * `simTime` / `reset()`), or `null` while `world` is not ready.
 *
 * ```tsx
 * const stepper = useFixedStep(world, {
 *   onStep: () => { sleep.forceSleepSettled(); sleep.sweep(stepper.simTime); },
 *   onAfterFrame: (stepped) => { if (stepped) syncMesh(); },
 * });
 * ```
 */
export function useFixedStep(
  world: World | null,
  options: UseFixedStepOptions = {},
): FixedStepper | null {
  const stepperRef = useRef<FixedStepper | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  // (Re)build the stepper when the timing config changes — not on every callback
  // change (callbacks are read live from optsRef).
  const { fixedDt, substeps, maxDeltaClamp, maxStepsPerFrame } = options;
  useEffect(() => {
    stepperRef.current = new FixedStepper({
      fixedDt,
      substeps,
      maxDeltaClamp,
      maxStepsPerFrame,
    });
    return () => {
      stepperRef.current = null;
    };
  }, [fixedDt, substeps, maxDeltaClamp, maxStepsPerFrame]);

  useFrame((_state, delta) => {
    const stepper = stepperRef.current;
    const opts = optsRef.current;
    if (!world || !stepper || opts.paused) return;

    const substepsArg = stepper.substeps;
    const stepped = stepper.advance(delta, (dt) => {
      world.step(dt, substepsArg);
      opts.onStep?.(dt, stepper.simTime);
    });
    opts.onAfterFrame?.(stepped);
  }, options.priority ?? 0);

  return stepperRef.current;
}
