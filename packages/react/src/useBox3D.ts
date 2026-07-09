/**
 * Module-init hooks. box3d's WASM load is async, so React needs an explicit story
 * for "physics isn't ready yet." We ship two, matching how drei splits useGLTF
 * (suspends) from a manual loader:
 *
 *   - `useBox3D()`      — Suspense-integrated. Throws a cached promise on first
 *                          render (drei/useGLTF pattern); wrap the tree in
 *                          <Suspense> and physics readiness gates on it. Returns a
 *                          ready `Box3D` synchronously once resolved.
 *   - `useBox3DAsync()` — non-suspending escape hatch. Returns
 *                          `{ box3d, loading, error }`; you render your own
 *                          fallback. Use when you can't/won't add a Suspense
 *                          boundary (e.g. a HUD that must paint before physics).
 *
 * The underlying `createBox3D()` promise is cached by a stable key so StrictMode's
 * dev double-invoke, multiple components, and re-renders all share ONE module +
 * one WASM instance. The module is process-global and intentionally never
 * disposed by these hooks — worlds are the disposable unit (see `useWorld`).
 */
import { useEffect, useState } from 'react';
import { createBox3D, type Box3D, type Box3DLoadOptions } from 'box3d-web';

type CacheEntry = {
  promise: Promise<Box3D>;
  box3d?: Box3D;
  error?: unknown;
};

// Keyed cache so the SAME load options reuse one module across the whole app +
// across StrictMode's double render. Different options (e.g. a different wasmUrl)
// get a distinct module, which is the correct behavior for multi-build setups.
const cache = new Map<string, CacheEntry>();

function keyOf(options?: Box3DLoadOptions): string {
  if (!options) return '__default__';
  // Only URL-ish fields meaningfully change identity; binary/locateFile callers
  // opt into a fresh module by passing a distinct wasmUrl or clearing the cache.
  const url = options.wasmUrl instanceof URL ? options.wasmUrl.href : options.wasmUrl;
  return url ? `url:${url}` : '__default__';
}

function getEntry(options?: Box3DLoadOptions): CacheEntry {
  const key = keyOf(options);
  let entry = cache.get(key);
  if (!entry) {
    entry = { promise: createBox3D(options) };
    entry.promise.then(
      (b3) => {
        entry!.box3d = b3;
      },
      (err) => {
        entry!.error = err;
      },
    );
    cache.set(key, entry);
  }
  return entry;
}

/**
 * Suspense-integrated box3d module. Throws the load promise until the WASM is
 * ready (React shows the nearest `<Suspense fallback>`), then returns a live
 * `Box3D` on every subsequent render. Rejections are re-thrown so an error
 * boundary can catch them.
 *
 * ```tsx
 * function Scene() {
 *   const box3d = useBox3D();          // suspends until ready
 *   const world = useWorld(box3d);
 *   // ...
 * }
 * // <Suspense fallback={<Loading />}><Scene /></Suspense>
 * ```
 *
 * Multiple components calling `useBox3D()` with the same options share one module.
 */
export function useBox3D(options?: Box3DLoadOptions): Box3D {
  const entry = getEntry(options);
  if (entry.error) throw entry.error;
  if (!entry.box3d) throw entry.promise; // suspend
  return entry.box3d;
}

/** Result shape of the non-suspending loader. */
export interface UseBox3DAsyncResult {
  /** The loaded module, or `null` while loading / on error. */
  box3d: Box3D | null;
  /** True until the promise settles. */
  loading: boolean;
  /** The rejection value if the load failed, else `null`. */
  error: unknown;
}

/**
 * Non-suspending module loader. Returns `{ box3d, loading, error }` and re-renders
 * when the load settles — render your own fallback rather than a Suspense boundary.
 * Shares the same cached module as `useBox3D` for identical options.
 */
export function useBox3DAsync(options?: Box3DLoadOptions): UseBox3DAsyncResult {
  const entry = getEntry(options);
  const [, force] = useState(0);

  useEffect(() => {
    if (entry.box3d || entry.error) return;
    let cancelled = false;
    entry.promise.finally(() => {
      if (!cancelled) force((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  return {
    box3d: entry.box3d ?? null,
    loading: !entry.box3d && !entry.error,
    error: entry.error ?? null,
  };
}

/**
 * Clear the module cache (test/HMR aid). Does NOT dispose already-loaded modules —
 * callers holding a `Box3D` keep using it; this only forces the next hook call to
 * load a fresh one. Rarely needed in app code.
 */
export function clearBox3DCache(): void {
  cache.clear();
}
