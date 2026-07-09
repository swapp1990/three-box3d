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

export class FixedStepper {
  readonly fixedDt: number;
  readonly substeps: number;
  private readonly maxDeltaClamp: number;
  private readonly maxStepsPerFrame: number;
  private accumulator = 0;
  private _simTime = 0;

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
      onStep(this.fixedDt);
      this._simTime += this.fixedDt;
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    // Anti-death-spiral: drop any remaining backlog beyond one step.
    if (this.accumulator >= this.fixedDt) {
      this.accumulator %= this.fixedDt;
    }
    return steps;
  }

  /** Total simulated time (s), monotone in fixed increments. */
  get simTime(): number {
    return this._simTime;
  }

  reset(): void {
    this.accumulator = 0;
    this._simTime = 0;
  }
}
