/**
 * SleepManager — island-aware sleep discipline. box3d sleeps ISLANDS, not bodies:
 * waking one body in a settled stack wakes the whole structure. So: force-sleep
 * after a fresh spawn settles, then periodically sleep bodies that moved
 * <threshold over the sweep interval.
 *
 * Engine mapping: `sleepBody` → `b3Body_SetAwake(false)` → `b3TrySleepIsland`,
 * which moves the body's entire contact island to the sleeping set without
 * checking other members' velocities. Optional `neighborRadius` therefore
 * cluster-gates the sweep: a body is slept only when every currently-awake
 * neighbor in its spatial cluster is also quiet.
 *
 * Buffer interaction: resolves each body's pose via `buffer.offsetOf(body)` on
 * EVERY sweep — it never caches slot indices, because TransformBuffer removal
 * renumbers slots on rebuild.
 */
import type { BodyHandle } from '../types.js';

interface WorldLike {
  sleepBody(body: BodyHandle): void;
  readSleepStates?(ids: Int32Array, out: Uint8Array): Uint8Array;
}

interface BufferLike {
  offsetOf(body: BodyHandle): number | undefined;
  readonly transforms: Float32Array;
}

export interface SleepManagerOptions {
  settleSteps?: number; // steps to let a fresh spawn settle, default 2
  sweepIntervalSec?: number; // periodic sweep cadence, default 2 s
  moveThreshold?: number; // per-sweep displacement to still count as "moving", default 0.01 m
  /** Per-sweep quaternion displacement bound: quiet iff pos AND `1-|dot(qPrev,qNow)|` < this.
   *  Unset / ≤0 → rotation ignored (legacy). */
  angleThreshold?: number;
  /** When set, union-find clusters over currently-awake watched bodies whose
   *  centers are within this radius and sleep a body only if its whole cluster
   *  is quiet. Unset / ≤0 → legacy per-body sweep. */
  neighborRadius?: number;
  /** If provided, a body is force-slept / sweep-slept only when this returns true. */
  shouldSleep?: (body: BodyHandle) => boolean;
}

const SAMPLE_STRIDE = 7; // x,y,z,qx,qy,qz,qw — matches TransformBuffer layout

export class SleepManager {
  private readonly world: WorldLike;
  private readonly settleSteps: number;
  private readonly sweepIntervalSec: number;
  private readonly moveThresholdSq: number;
  private readonly angleThreshold: number; // 0 = ignore rotation
  private readonly neighborRadius: number; // 0 = per-body (legacy)
  private readonly neighborRadiusSq: number;
  private readonly shouldSleep: (body: BodyHandle) => boolean;

  private watched: readonly BodyHandle[] = [];
  private buffer: BufferLike | null = null;

  // Force-sleep bookkeeping.
  private settleCountdown = -1; // -1 = not pending
  // Sweep bookkeeping: last sampled pose (7 floats per watched body).
  private lastSample: Float32Array = new Float32Array(0);
  private sampleValid = false;
  private nextSweepTime = 0;

  // Cluster-gate scratch (sized in watch(); unused when neighborRadius is 0).
  private watchedIds: Int32Array = new Int32Array(0);
  private sleepOut: Uint8Array = new Uint8Array(0);
  private ufParent: Int32Array = new Int32Array(0);
  private quiet: Uint8Array = new Uint8Array(0);
  private eligible: Uint8Array = new Uint8Array(0);
  private clusterQuiet: Uint8Array = new Uint8Array(0);
  private offsets: Int32Array = new Int32Array(0);
  private readonly cells = new Map<number, number[]>();

  constructor(world: WorldLike, options: SleepManagerOptions = {}) {
    this.world = world;
    this.settleSteps =
      options.settleSteps != null && options.settleSteps >= 0 ? options.settleSteps | 0 : 2;
    this.sweepIntervalSec =
      options.sweepIntervalSec && options.sweepIntervalSec > 0 ? options.sweepIntervalSec : 2;
    const thr = options.moveThreshold && options.moveThreshold > 0 ? options.moveThreshold : 0.01;
    this.moveThresholdSq = thr * thr;
    this.angleThreshold =
      options.angleThreshold != null && options.angleThreshold > 0 ? options.angleThreshold : 0;
    this.neighborRadius =
      options.neighborRadius != null && options.neighborRadius > 0 ? options.neighborRadius : 0;
    this.neighborRadiusSq = this.neighborRadius * this.neighborRadius;
    this.shouldSleep = options.shouldSleep ?? (() => true);
  }

  /** Track bodies (their poses live in the given TransformBuffer). Arms a fresh
   *  force-sleep countdown and resets the sweep sampler. */
  watch(bodies: readonly BodyHandle[], buffer: TransformBufferParam): void {
    this.watched = bodies.slice();
    this.buffer = buffer;
    this.settleCountdown = this.settleSteps;
    const n = this.watched.length;
    this.lastSample = new Float32Array(n * SAMPLE_STRIDE);
    this.watchedIds = new Int32Array(n);
    this.sleepOut = new Uint8Array(n);
    this.ufParent = new Int32Array(n);
    this.quiet = new Uint8Array(n);
    this.eligible = new Uint8Array(n);
    this.clusterQuiet = new Uint8Array(n);
    this.offsets = new Int32Array(n);
    for (let i = 0; i < n; i++) this.watchedIds[i] = this.watched[i] as number;
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
      const body = this.watched[i];
      if (this.shouldSleep(body)) this.world.sleepBody(body);
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

    if (this.neighborRadius > 0) {
      this.sweepClustered(buffer);
    } else {
      this.sweepPerBody(buffer);
    }
    this.sample(buffer);
    this.nextSweepTime = simTime + this.sweepIntervalSec;
  }

  private sweepPerBody(buffer: BufferLike): void {
    const transforms = buffer.transforms;
    for (let i = 0; i < this.watched.length; i++) {
      const body = this.watched[i];
      const offset = buffer.offsetOf(body);
      if (offset === undefined) continue;
      if (this.isQuiet(i, offset, transforms) && this.shouldSleep(body)) {
        this.world.sleepBody(body);
      }
    }
  }

  private sweepClustered(buffer: BufferLike): void {
    const readSleep = this.world.readSleepStates;
    if (typeof readSleep !== 'function') {
      throw new TypeError('SleepManager: neighborRadius requires world.readSleepStates');
    }
    const n = this.watched.length;
    const transforms = buffer.transforms;
    const ids = this.watchedIds;
    const sleepOut = this.sleepOut;
    const quiet = this.quiet;
    const eligible = this.eligible;
    const parent = this.ufParent;
    const offsets = this.offsets;
    readSleep.call(this.world, ids, sleepOut);

    eligible.fill(0);
    quiet.fill(0);
    for (let i = 0; i < n; i++) {
      parent[i] = i;
      const offset = buffer.offsetOf(this.watched[i]);
      offsets[i] = offset === undefined ? -1 : offset;
      if (sleepOut[i] !== 1) continue; // already asleep: not clustered, not re-slept
      if (offset === undefined) continue; // missing slot: skip
      eligible[i] = 1;
      quiet[i] = this.isQuiet(i, offset, transforms) ? 1 : 0;
    }

    const cells = this.cells;
    cells.clear();
    const inv = 1 / this.neighborRadius;
    const last = this.lastSample;
    for (let i = 0; i < n; i++) {
      if (!eligible[i]) continue;
      const offset = offsets[i];
      this.insertCell(
        Math.floor(transforms[offset] * inv),
        Math.floor(transforms[offset + 1] * inv),
        Math.floor(transforms[offset + 2] * inv),
        i,
      );
      // Also hash the previous center so a body that left the neighborhood
      // this interval still vetoes the cluster it departed.
      const so = i * SAMPLE_STRIDE;
      const px = last[so];
      if (!Number.isFinite(px)) continue;
      const py = last[so + 1];
      const pz = last[so + 2];
      if (!Number.isFinite(py) || !Number.isFinite(pz)) continue;
      this.insertCell(Math.floor(px * inv), Math.floor(py * inv), Math.floor(pz * inv), i);
    }

    const radiusSq = this.neighborRadiusSq;
    for (let i = 0; i < n; i++) {
      if (!eligible[i]) continue;
      const offset = offsets[i];
      const x = transforms[offset];
      const y = transforms[offset + 1];
      const z = transforms[offset + 2];
      const so = i * SAMPLE_STRIDE;
      const px = last[so];
      const py = last[so + 1];
      const pz = last[so + 2];
      this.unionNear(i, x, y, z, inv, radiusSq, offsets, transforms, last);
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        this.unionNear(i, px, py, pz, inv, radiusSq, offsets, transforms, last);
      }
    }

    const clusterQuiet = this.clusterQuiet;
    clusterQuiet.fill(1);
    for (let i = 0; i < n; i++) {
      if (!eligible[i]) continue;
      if (!quiet[i]) clusterQuiet[this.ufFind(i)] = 0;
    }
    for (let i = 0; i < n; i++) {
      if (!eligible[i]) continue;
      const body = this.watched[i];
      if (clusterQuiet[this.ufFind(i)] && this.shouldSleep(body)) {
        this.world.sleepBody(body);
      }
    }
  }

  /** Quiet = displacement under moveThreshold AND (if enabled) quat under angleThreshold.
   *  Missing/NaN samples are non-quiet. Caller must skip undefined offsets. */
  private isQuiet(i: number, offset: number, transforms: Float32Array): boolean {
    const so = i * SAMPLE_STRIDE;
    const px = this.lastSample[so];
    const py = this.lastSample[so + 1];
    const pz = this.lastSample[so + 2];
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return false;
    const cx = transforms[offset];
    const cy = transforms[offset + 1];
    const cz = transforms[offset + 2];
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return false;
    const dx = cx - px;
    const dy = cy - py;
    const dz = cz - pz;
    if (dx * dx + dy * dy + dz * dz >= this.moveThresholdSq) return false;
    if (this.angleThreshold > 0) {
      const qx = this.lastSample[so + 3];
      const qy = this.lastSample[so + 4];
      const qz = this.lastSample[so + 5];
      const qw = this.lastSample[so + 6];
      if (
        !Number.isFinite(qx) ||
        !Number.isFinite(qy) ||
        !Number.isFinite(qz) ||
        !Number.isFinite(qw)
      ) {
        return false;
      }
      const nx = transforms[offset + 3];
      const ny = transforms[offset + 4];
      const nz = transforms[offset + 5];
      const nw = transforms[offset + 6];
      if (
        !Number.isFinite(nx) ||
        !Number.isFinite(ny) ||
        !Number.isFinite(nz) ||
        !Number.isFinite(nw)
      ) {
        return false;
      }
      const quatDelta = 1 - Math.abs(qx * nx + qy * ny + qz * nz + qw * nw);
      if (quatDelta >= this.angleThreshold) return false;
    }
    return true;
  }

  private insertCell(ix: number, iy: number, iz: number, i: number): void {
    const key = ix * 73856093 + iy * 19349663 + iz * 83492791;
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(i);
  }

  /** Union i with any eligible j whose current or previous center is within
   *  neighborRadius of (x,y,z). (x,y,z) is i's current or previous center. */
  private unionNear(
    i: number,
    x: number,
    y: number,
    z: number,
    inv: number,
    radiusSq: number,
    offsets: Int32Array,
    transforms: Float32Array,
    last: Float32Array,
  ): void {
    const ix = Math.floor(x * inv);
    const iy = Math.floor(y * inv);
    const iz = Math.floor(z * inv);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = this.cells.get(
            (ix + dx) * 73856093 + (iy + dy) * 19349663 + (iz + dz) * 83492791,
          );
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (j <= i || !this.eligible[j]) continue;
            const jo = offsets[j];
            const jx = transforms[jo];
            const jy = transforms[jo + 1];
            const jz = transforms[jo + 2];
            if (this.distSq(x, y, z, jx, jy, jz) <= radiusSq) {
              this.ufUnion(i, j);
              continue;
            }
            const js = j * SAMPLE_STRIDE;
            const jpx = last[js];
            const jpy = last[js + 1];
            const jpz = last[js + 2];
            if (
              Number.isFinite(jpx) &&
              Number.isFinite(jpy) &&
              Number.isFinite(jpz) &&
              this.distSq(x, y, z, jpx, jpy, jpz) <= radiusSq
            ) {
              this.ufUnion(i, j);
            }
          }
        }
      }
    }
  }

  private distSq(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): number {
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    return dx * dx + dy * dy + dz * dz;
  }

  private ufFind(i: number): number {
    const p = this.ufParent;
    let r = i;
    while (p[r] !== r) r = p[r];
    let x = i;
    while (x !== r) {
      const n = p[x];
      p[x] = r;
      x = n;
    }
    return r;
  }

  private ufUnion(a: number, b: number): void {
    a = this.ufFind(a);
    b = this.ufFind(b);
    if (a !== b) this.ufParent[a] = b;
  }

  private sample(buffer: BufferLike): void {
    const transforms = buffer.transforms;
    const last = this.lastSample;
    for (let i = 0; i < this.watched.length; i++) {
      const offset = buffer.offsetOf(this.watched[i]);
      const so = i * SAMPLE_STRIDE;
      if (offset === undefined) {
        last[so] = NaN;
        last[so + 1] = NaN;
        last[so + 2] = NaN;
        last[so + 3] = NaN;
        last[so + 4] = NaN;
        last[so + 5] = NaN;
        last[so + 6] = NaN;
        continue;
      }
      last[so] = transforms[offset];
      last[so + 1] = transforms[offset + 1];
      last[so + 2] = transforms[offset + 2];
      last[so + 3] = transforms[offset + 3];
      last[so + 4] = transforms[offset + 4];
      last[so + 5] = transforms[offset + 5];
      last[so + 6] = transforms[offset + 6];
    }
  }
}

// Structural type for the buffer parameter (avoids importing the concrete class
// so SleepManager stays decoupled and tree-shakeable).
type TransformBufferParam = BufferLike;
