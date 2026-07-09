/**
 * TransformBuffer — owns the Int32Array id list + Float32Array 7-float pose
 * layout ([x,y,z, qx,qy,qz,qw] per body), with dirty rebuild. This is the buffer
 * you hand to `World.readTransforms` and to the three-box3d adapter.
 *
 * Slot semantics (frozen): bodies are INSERTION-ORDERED and the packed arrays are
 * compacted on rebuild. Removing a body RENUMBERS every body after it — slot
 * indices are NOT stable across rebuilds. Never cache an index or byte offset
 * across a rebuild; always resolve through `offsetOf(body)`.
 */
import type { BodyHandle } from '../types.js';

interface WorldLike {
  readTransforms(ids: Int32Array, out: Float32Array): Float32Array;
}

export class TransformBuffer {
  // Insertion-ordered live body list (the source of truth for order).
  private order: number[] = [];
  private dirty = true;

  private _ids: Int32Array;
  private _transforms: Float32Array;
  private _count = 0;
  // body -> current slot index, rebuilt on demand.
  private offsets = new Map<number, number>();

  constructor(capacity = 0) {
    const cap = Math.max(0, capacity | 0);
    this._ids = new Int32Array(cap);
    this._transforms = new Float32Array(cap * 7);
  }

  /** Track a body (appended in insertion order). Marks dirty. */
  add(body: BodyHandle): void {
    this.order.push(body);
    this.dirty = true;
  }

  /** Untrack a body. Marks dirty; packed arrays compact (later bodies renumber)
   *  on the next rebuild. */
  remove(body: BodyHandle): void {
    const idx = this.order.indexOf(body);
    if (idx !== -1) {
      this.order.splice(idx, 1);
      this.dirty = true;
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Rebuild the packed id array if dirty (call before readInto). */
  rebuild(): void {
    if (!this.dirty) return;
    const n = this.order.length;
    if (this._ids.length < n) {
      this._ids = new Int32Array(n);
    }
    if (this._transforms.length < n * 7) {
      this._transforms = new Float32Array(n * 7);
    }
    this.offsets.clear();
    for (let i = 0; i < n; i++) {
      const body = this.order[i];
      this._ids[i] = body;
      this.offsets.set(body, i * 7);
    }
    this._count = n;
    this.dirty = false;
  }

  /** Read all tracked bodies' poses via the world, once per step. */
  readInto(world: WorldLike): void {
    if (this.dirty) this.rebuild();
    if (this._count === 0) return;
    // Pass exact-length views so readTransforms' length checks see `count`, not
    // the (possibly larger) backing capacity.
    const ids = this._count === this._ids.length ? this._ids : this._ids.subarray(0, this._count);
    const out =
      this._count * 7 === this._transforms.length
        ? this._transforms
        : this._transforms.subarray(0, this._count * 7);
    world.readTransforms(ids as Int32Array, out as Float32Array);
  }

  /** Body → CURRENT 7-float offset into `transforms` (undefined if untracked).
   *  Do not cache the result across rebuilds. */
  offsetOf(body: BodyHandle): number | undefined {
    if (this.dirty) this.rebuild();
    return this.offsets.get(body);
  }

  /** Packed, insertion-ordered ids, length = count. */
  get ids(): Int32Array {
    if (this.dirty) this.rebuild();
    return this._count === this._ids.length ? this._ids : this._ids.subarray(0, this._count);
  }

  /** 7*count floats. */
  get transforms(): Float32Array {
    if (this.dirty) this.rebuild();
    return this._count * 7 === this._transforms.length
      ? this._transforms
      : this._transforms.subarray(0, this._count * 7);
  }

  get count(): number {
    if (this.dirty) this.rebuild();
    return this._count;
  }
}
