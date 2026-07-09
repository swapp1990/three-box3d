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
  private readonly onEvict?: (body: BodyHandle) => void;
  private readonly _bodies: BodyHandle[] = [];

  constructor(world: WorldLike, options: { max: number; onEvict?: (body: BodyHandle) => void }) {
    this.world = world;
    this.max = Math.max(0, options.max | 0);
    this.onEvict = options.onEvict;
  }

  /** Spawn via your factory, register, and evict oldest if over cap. */
  spawn(create: (world: WorldLike) => BodyHandle): BodyHandle {
    const body = create(this.world);
    this._bodies.push(body);
    while (this._bodies.length > this.max) {
      const oldest = this._bodies.shift();
      if (oldest !== undefined) {
        this.onEvict?.(oldest);
        this.world.destroyBody(oldest);
      }
    }
    return body;
  }

  destroyAll(): void {
    for (const body of this._bodies) {
      this.onEvict?.(body);
      this.world.destroyBody(body);
    }
    this._bodies.length = 0;
  }

  get bodies(): readonly BodyHandle[] {
    return this._bodies;
  }
}
