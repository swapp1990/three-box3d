/**
 * useTransformBuffer — a stable `TransformBuffer` that tracks a list of bodies and
 * rebuilds when the set changes. The buffer instance identity is stable across
 * renders (it is not recreated when the body list changes); only its tracked set
 * is diffed and updated, then marked dirty so the next `readInto` repacks.
 *
 * Pass the SAME buffer to `useInstancedTransforms`, `SleepManager`, and
 * `radialImpulse` — one flat buffer feeds every consumer (the frozen core
 * contract). Never cache a body's slot offset across a rebuild; resolve through
 * `buffer.offsetOf(body)`.
 */
import { useMemo, useRef } from 'react';
import { TransformBuffer, type BodyHandle } from 'box3d-web';

/**
 * Create (once) a `TransformBuffer` and keep its tracked-body set in sync with
 * `bodies`. The returned buffer is referentially stable.
 *
 * ```tsx
 * const buffer = useTransformBuffer(bricks, bricks.length);
 * useFixedStep(world, { onAfterFrame: (s) => { if (s) { buffer.readInto(world); } } });
 * ```
 *
 * @param bodies the bodies to track, in the order you want them packed. Diffed by
 *   value against the previous render; add/remove marks the buffer dirty.
 * @param capacity initial backing capacity hint (grows automatically). Defaults to
 *   `bodies.length`.
 * @returns a stable `TransformBuffer`.
 */
export function useTransformBuffer(
  bodies: readonly BodyHandle[],
  capacity?: number,
): TransformBuffer {
  const buffer = useMemo(
    () => new TransformBuffer(capacity ?? bodies.length),
    // Create once; capacity is only an initial hint, bodies re-sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Track the last-applied set so we only touch the buffer on real changes.
  const trackedRef = useRef<Set<BodyHandle>>(new Set());

  const next = new Set(bodies);
  const tracked = trackedRef.current;
  let changed = false;

  // Removals first (so add-then-remove of the same handle in one render is a no-op).
  for (const body of tracked) {
    if (!next.has(body)) {
      buffer.remove(body);
      changed = true;
    }
  }
  // Additions in the caller's order (insertion order is the packed order).
  for (const body of bodies) {
    if (!tracked.has(body)) {
      buffer.add(body);
      changed = true;
    }
  }

  if (changed) {
    trackedRef.current = next;
  }

  return buffer;
}
