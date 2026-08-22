/**
 * BodyPool ⚠️ EXPERIMENTAL — NOT frozen in v0.1.
 *
 * This API may change in v0.5 — in particular the closure-based `spawn` may be
 * revised. Everything else in box3d-web is frozen; BodyPool is the one exception.
 *
 * Capped pool of transient bodies (debris, projectiles). When over cap, destroys
 * the OLDEST. You supply the spawn fn; the pool owns lifetime + eviction.
 * Extracted from the inline MAX_CANNONBALLS / MAX_BALLS destroy-oldest logic.
 */
import type { BodyHandle } from '../types.js';

interface WorldLike {
  destroyBody(body: BodyHandle): void;
}

export class BodyPool {
  private readonly world: WorldLike;
  private readonly max: number;
  private readonly maxAgeSec: number | undefined;
  private readonly onEvict?: (body: BodyHandle) => void;
  private readonly _bodies: BodyHandle[] = [];
  private readonly bornAt = new Map<BodyHandle, number>();
  private simTime = 0;

  constructor(
    world: WorldLike,
    options: { max: number; maxAgeSec?: number; onEvict?: (body: BodyHandle) => void },
  ) {
    this.world = world;
    this.max = Math.max(0, options.max | 0);
    this.maxAgeSec =
      options.maxAgeSec != null && Number.isFinite(options.maxAgeSec) && options.maxAgeSec > 0
        ? options.maxAgeSec
        : undefined;
    this.onEvict = options.onEvict;
  }

  /** Spawn via your factory, register, and evict oldest if over cap. */
  spawn(create: (world: WorldLike) => BodyHandle, simTime = this.simTime): BodyHandle {
    const body = create(this.world);
    this._bodies.push(body);
    this.bornAt.set(body, simTime);
    this.simTime = simTime;
    while (this._bodies.length > this.max) {
      const oldest = this._bodies.shift();
      if (oldest !== undefined) {
        this.bornAt.delete(oldest);
        this.dispose(oldest);
      }
    }
    return body;
  }

  /** Retire and destroy a tracked body. Returns false when it is already retired. */
  retire(body: BodyHandle): boolean {
    const index = this._bodies.indexOf(body);
    if (index < 0) return false;
    this._bodies.splice(index, 1);
    this.bornAt.delete(body);
    this.dispose(body);
    return true;
  }

  /** Retire bodies whose age has reached `maxAgeSec`; no-op when age expiry is disabled. */
  sweep(simTime: number): number {
    const maxAgeSec = this.maxAgeSec;
    if (maxAgeSec === undefined || !Number.isFinite(simTime)) return 0;
    this.simTime = simTime;
    const expired = this._bodies.filter((body) => {
      const born = this.bornAt.get(body);
      return born !== undefined && simTime - born >= maxAgeSec;
    });
    let retired = 0;
    for (const body of expired) {
      if (this.retire(body)) retired += 1;
    }
    return retired;
  }

  has(body: BodyHandle): boolean {
    return this._bodies.includes(body);
  }

  destroyAll(): void {
    const bodies = this._bodies.splice(0);
    let firstError: unknown;
    let failed = false;
    for (const body of bodies) {
      this.bornAt.delete(body);
      try {
        this.dispose(body);
      } catch (error) {
        if (!failed) {
          firstError = error;
          failed = true;
        }
      }
    }
    if (failed) throw firstError;
  }

  get bodies(): readonly BodyHandle[] {
    return this._bodies;
  }

  private dispose(body: BodyHandle): void {
    try {
      this.onEvict?.(body);
    } finally {
      this.world.destroyBody(body);
    }
  }
}
