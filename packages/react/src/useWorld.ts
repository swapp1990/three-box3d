/**
 * useWorld — a physics `World` whose lifetime is tied to the component's.
 *
 * StrictMode (React 18/19 dev) double-invokes effects: mount → cleanup → mount.
 * A naive "create in effect, destroy in cleanup" would destroy the world between
 * the two mounts and leave every consumer (frame loop, scene-build effect) holding
 * a destroyed handle for a frame — box3d throws "used after destroy" on the next
 * access. So we DEFER destruction: the cleanup schedules a microtask-delayed
 * destroy, and a re-mount within the same tick CANCELS it. The result is one
 * stable world across the StrictMode remount — same identity, never destroyed
 * mid-life — and a real unmount still destroys it (nothing cancels the schedule).
 *
 * The world is created lazily and published via state, so the hook returns `null`
 * on the first render and the live `World` once created. Because the world arrives
 * after first render, create bodies/shapes in your OWN effect keyed on the
 * returned world, NOT during render.
 *
 * `options` are read once at creation; a changed `box3d` module recreates the
 * world. Reconfigure gravity at runtime via `world.setGravity(...)`.
 */
import { useEffect, useState } from 'react';
import type { Box3D, World, WorldOptions } from 'box3d-web';

// Per-(hook instance) mutable box. We keep it outside React state so the deferred
// destroy + re-mount cancellation survive the StrictMode cleanup/mount pair.
interface Slot {
  box3d: Box3D | null;
  world: World | null;
  pendingDestroy: boolean;
}

export function useWorld(box3d: Box3D | null, options?: WorldOptions): World | null {
  const [world, setWorld] = useState<World | null>(null);
  // One slot per mounted hook, created lazily via a state initializer so it's
  // stable across renders (including the StrictMode double render).
  const [slot] = useState<Slot>(() => ({ box3d: null, world: null, pendingDestroy: false }));

  useEffect(() => {
    if (!box3d) {
      setWorld(null);
      return;
    }

    // A pending destroy from a StrictMode cleanup? Cancel it and reuse the world.
    if (slot.world && slot.box3d === box3d) {
      slot.pendingDestroy = false;
      setWorld(slot.world);
    } else {
      // Fresh world (first mount, or the module changed → drop the old one).
      if (slot.world) slot.world.destroy();
      slot.world = box3d.createWorld(options);
      slot.box3d = box3d;
      slot.pendingDestroy = false;
      setWorld(slot.world);
    }

    return () => {
      // Defer: a StrictMode remount runs its effect in the SAME tick and clears
      // this flag before the microtask fires, so the world survives. A real
      // unmount leaves the flag set → the world is destroyed.
      slot.pendingDestroy = true;
      queueMicrotask(() => {
        if (slot.pendingDestroy && slot.world) {
          slot.world.destroy();
          slot.world = null;
          slot.box3d = null;
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box3d]);

  return world;
}
