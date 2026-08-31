/**
 * FixedStepper — fixed-timestep accumulator with a death-spiral guard.
 *
 * Extracted from the inline accumulators in yard/playground/cup physics. Feed it a
 * frame delta; it runs 0..maxStepsPerFrame fixed steps via `onStep`. If the sim
 * can't keep up with real time, the backlog is DROPPED (via modulo) rather than
 * compounded, so the sim runs slightly slow-motion under load instead of freezing.
 *
 * No three import, no world dependency — pure timing.
 */
export interface FixedStepperOptions {
  fixedDt?: number; // default 1/60
  substeps?: number; // default 4 (informational; forwarded by the caller to world.step)
  maxDeltaClamp?: number; // clamp a single frame delta, default 0.1 s
  maxStepsPerFrame?: number; // death-spiral guard, default 3 (drops backlog via modulo)
}

/** Immutable timing/overflow counters for diagnostics and shared-world schedulers. */
export interface FixedStepperTelemetry {
  readonly simTime: number;
  readonly accumulator: number;
  readonly totalExecutedSteps: number;
  /** Time discarded when the catch-up budget drops whole fixed steps. */
  readonly droppedBacklogTime: number;
  /** Whole fixed steps represented by `droppedBacklogTime`. */
  readonly droppedBacklogSteps: number;
  readonly maxStepsPerFrame: number;
}

export class FixedStepper {
  readonly fixedDt: number;
  readonly substeps: number;
  private readonly maxDeltaClamp: number;
  /** Mutable catch-up budget; change via setMaxStepsPerFrame (does not reset clocks). */
  private maxStepsPerFrame: number;
  private accumulator = 0;
  private _simTime = 0;
  private totalExecutedSteps = 0;
  private droppedBacklogTime = 0;
  private droppedBacklogSteps = 0;

  constructor(options: FixedStepperOptions = {}) {
    this.fixedDt = options.fixedDt && options.fixedDt > 0 ? options.fixedDt : 1 / 60;
    this.substeps = options.substeps && options.substeps > 0 ? options.substeps | 0 : 4;
    this.maxDeltaClamp =
      options.maxDeltaClamp && options.maxDeltaClamp > 0 ? options.maxDeltaClamp : 0.1;
    this.maxStepsPerFrame =
      options.maxStepsPerFrame && options.maxStepsPerFrame > 0
        ? options.maxStepsPerFrame | 0
        : 3;
  }

  /**
   * Update the per-frame catch-up step budget without touching accumulator or simTime.
   *
   * Finite values are truncated toward zero with `| 0` (same as the constructor).
   * The truncated result must be an integer ≥ 1; otherwise throws RangeError.
   * Fractional inputs like 2.9 become 2; 0.9 / NaN / ±Infinity / negatives throw.
   */
  setMaxStepsPerFrame(value: number): void {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `FixedStepper.setMaxStepsPerFrame: expected finite number ≥ 1, got ${value}`,
      );
    }
    const budget = value | 0;
    if (budget < 1) {
      throw new RangeError(
        `FixedStepper.setMaxStepsPerFrame: expected integer budget ≥ 1 (after truncating toward zero), got ${value}`,
      );
    }
    this.maxStepsPerFrame = budget;
  }

  /**
   * Execute exactly one fixed step without consuming or changing the frame
   * accumulator. This is useful when a caller owns a shared accumulator/world
   * and needs each participant's logical clock to advance with that world.
   */
  stepOnce(onStep: (dt: number) => void): void {
    this.executeStep(onStep);
  }

  /**
   * Feed a frame delta; runs 0..maxStepsPerFrame fixed steps via `onStep`.
   * Returns how many steps ran (0 = no visual change needed this frame).
   */
  advance(delta: number, onStep: (dt: number) => void): number {
    const clamped = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), this.maxDeltaClamp);
    // Cap the accumulator itself so a long stall can't bank unbounded backlog.
    this.accumulator = Math.min(
      this.accumulator + clamped,
      this.maxDeltaClamp + this.fixedDt,
    );

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
      this.executeStep(onStep);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    // Anti-death-spiral: drop any remaining backlog beyond one step.
    if (this.accumulator >= this.fixedDt) {
      const retained = this.accumulator % this.fixedDt;
      const dropped = this.accumulator - retained;
      this.accumulator = retained;
      this.droppedBacklogTime += dropped;
      // The modulo operation leaves a whole-step quotient, subject only to
      // floating-point noise. Round that quotient so the counter remains an
      // exact integer for fixed dt values such as 1/60.
      this.droppedBacklogSteps += Math.max(0, Math.round(dropped / this.fixedDt));
    }
    return steps;
  }

  /** Snapshot counters without exposing mutable internal state. */
  telemetry(): FixedStepperTelemetry {
    return Object.freeze({
      simTime: this._simTime,
      accumulator: this.accumulator,
      totalExecutedSteps: this.totalExecutedSteps,
      droppedBacklogTime: this.droppedBacklogTime,
      droppedBacklogSteps: this.droppedBacklogSteps,
      maxStepsPerFrame: this.maxStepsPerFrame,
    });
  }

  private executeStep(onStep: (dt: number) => void): void {
    onStep(this.fixedDt);
    this._simTime += this.fixedDt;
    this.totalExecutedSteps += 1;
  }

  /** Total simulated time (s), monotone in fixed increments. */
  get simTime(): number {
    return this._simTime;
  }

  reset(): void {
    this.accumulator = 0;
    this._simTime = 0;
    this.totalExecutedSteps = 0;
    this.droppedBacklogTime = 0;
    this.droppedBacklogSteps = 0;
  }
}
