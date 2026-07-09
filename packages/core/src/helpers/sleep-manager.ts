/**
 * SleepManager — island-aware sleep discipline. box3d sleeps ISLANDS, not bodies:
 * waking one body in a settled stack wakes the whole structure. So: force-sleep
 * after a fresh spawn settles, then periodically sleep bodies that moved
 * <threshold over the sweep interval.
 *
 * Buffer interaction: resolves each body's pose via `buffer.offsetOf(body)` on
 * EVERY sweep — it never caches slot indices, because TransformBuffer removal
 * renumbers slots on rebuild.
 */
import type { BodyHandle } from '../types.js';

interface WorldLike {
  sleepBody(body: BodyHandle): void;
}

interface BufferLike {
  offsetOf(body: BodyHandle): number | undefined;
  readonly transforms: Float32Array;
}

export interface SleepManagerOptions {
  settleSteps?: number; // steps to let a fresh spawn settle, default 2
  sweepIntervalSec?: number; // periodic sweep cadence, default 2 s
  moveThreshold?: number; // per-sweep displacement to still count as "moving", default 0.01 m
}

export class SleepManager {
  private readonly world: WorldLike;
  private readonly settleSteps: number;
  private readonly sweepIntervalSec: number;
  private readonly moveThresholdSq: number;

  private watched: readonly BodyHandle[] = [];
  private buffer: BufferLike | null = null;

  // Force-sleep bookkeeping.
  private settleCountdown = -1; // -1 = not pending
  // Sweep bookkeeping: last sampled positions (flat x,y,z per watched body).
  private lastSample: Float32Array = new Float32Array(0);
  private sampleValid = false;
  private nextSweepTime = 0;

  constructor(world: WorldLike, options: SleepManagerOptions = {}) {
    this.world = world;
    this.settleSteps =
      options.settleSteps != null && options.settleSteps >= 0 ? options.settleSteps | 0 : 2;
    this.sweepIntervalSec =
      options.sweepIntervalSec && options.sweepIntervalSec > 0 ? options.sweepIntervalSec : 2;
    const thr = options.moveThreshold && options.moveThreshold > 0 ? options.moveThreshold : 0.01;
    this.moveThresholdSq = thr * thr;
  }

  /** Track bodies (their poses live in the given TransformBuffer). Arms a fresh
   *  force-sleep countdown and resets the sweep sampler. */
  watch(bodies: readonly BodyHandle[], buffer: TransformBufferParam): void {
    this.watched = bodies.slice();
    this.buffer = buffer;
    this.settleCountdown = this.settleSteps;
    this.lastSample = new Float32Array(this.watched.length * 3);
    this.sampleValid = false;
    this.nextSweepTime = 0;
  }

  /** Force-sleep freshly spawned tracked bodies after `settleSteps` calls. Call
   *  once per fixed step; it counts down and fires exactly once. */
  forceSleepSettled(): void {
    if (this.settleCountdown < 0) return;
    if (this.settleCountdown > 0) {
      this.settleCountdown -= 1;
      return;
    }
    // countdown hit 0 this call → sleep everything, then disarm.
    for (let i = 0; i < this.watched.length; i++) {
      this.world.sleepBody(this.watched[i]);
    }
    this.settleCountdown = -1;
  }

  /** Run the periodic <threshold sweep; no-op until the interval elapses. */
  sweep(simTime: number): void {
    const buffer = this.buffer;
    if (!buffer || this.watched.length === 0) return;

    if (!this.sampleValid) {
      this.sample(buffer);
      this.sampleValid = true;
      this.nextSweepTime = simTime + this.sweepIntervalSec;
      return;
    }
    if (simTime < this.nextSweepTime) return;

    const transforms = buffer.transforms;
    for (let i = 0; i < this.watched.length; i++) {
      const body = this.watched[i];
      const offset = buffer.offsetOf(body);
      if (offset === undefined) continue;
      const so = i * 3;
      const dx = transforms[offset] - this.lastSample[so];
      const dy = transforms[offset + 1] - this.lastSample[so + 1];
      const dz = transforms[offset + 2] - this.lastSample[so + 2];
      if (dx * dx + dy * dy + dz * dz < this.moveThresholdSq) {
        this.world.sleepBody(body);
      }
    }
    this.sample(buffer);
    this.nextSweepTime = simTime + this.sweepIntervalSec;
  }

  private sample(buffer: BufferLike): void {
    const transforms = buffer.transforms;
    for (let i = 0; i < this.watched.length; i++) {
      const offset = buffer.offsetOf(this.watched[i]);
      const so = i * 3;
      if (offset === undefined) {
        this.lastSample[so] = NaN;
        this.lastSample[so + 1] = NaN;
        this.lastSample[so + 2] = NaN;
        continue;
      }
      this.lastSample[so] = transforms[offset];
      this.lastSample[so + 1] = transforms[offset + 1];
      this.lastSample[so + 2] = transforms[offset + 2];
    }
  }
}

// Structural type for the buffer parameter (avoids importing the concrete class
// so SleepManager stays decoupled and tree-shakeable).
type TransformBufferParam = BufferLike;
