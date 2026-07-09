# Gotchas

Every rule on this page cost real debugging time on a live, deployed three.js app before it was written down. They are not theoretical. If you're integrating a WASM physics engine with three.js or React Three Fiber, you will hit some of these — so here they are, in the order they're most likely to bite.

[[toc]]

## InstancedMesh + `setColorAt` renders black instances

**Symptom:** you tint an `InstancedMesh` per-instance with `setColorAt(...)` and every instance renders solid black.

**Cause:** the material has `vertexColors: true` but the geometry has no per-vertex color attribute. In that state three.js multiplies every instance's color by black. This bug hit **three separate meshes** on the dogfood app — the crowd, the intro letters, and the fan balls — before the rule was written down.

**Rule:**

> **InstancedMesh + `setColorAt` requires the material to NOT set `vertexColors: true`.**

Per-instance color goes through `InstancedMesh.instanceColor`, which is a *separate* channel from vertex colors. It works fine with the material default `vertexColors: false`. Leave it false:

```ts
const mat = new THREE.MeshStandardMaterial(); // vertexColors stays false ✓
const mesh = new THREE.InstancedMesh(geo, mat, count);
mesh.setColorAt(i, color);                    // instanceColor channel — works
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
```

`three-box3d`'s `writeTransformsToInstancedMesh` documents this inline for exactly this reason. Only set `vertexColors: true` if you *also* supply a color attribute on the geometry — which is not what per-instance tinting is.

## The native explode is a no-op on sleeping bodies

**Symptom:** you call the engine's explode on a settled pile and nothing moves.

**Cause:**

> **Native `b3World_Explode` is a NO-OP on sleeping bodies.**

And a settled pile is, by design, [asleep](../concepts/sleeping). So the built-in explode does nothing to precisely the bodies you wanted to launch.

**Fix — `radialImpulse`.** `box3d-web` ships a JS radial-impulse sweep that **wakes each in-range body first**, then applies a distance-falloff impulse with an optional upward bias:

```ts
import { radialImpulse } from 'box3d-web';

radialImpulse(world, bodies, buffer, {
  center: [x, y, z],
  radius: 3.5,
  strength: 6,
  falloff: 'quadratic',  // s = strength * (1 - d/radius)²   ('linear' also available)
  upwardBias: 0.5,        // add this fraction of local strength on +Y
});
```

It reads each body's pose from the `TransformBuffer` (no per-body query), wakes it, and applies the impulse at the body's position. This is the correct replacement for the native explode path everywhere.

## Isolate `<Environment>` and `<Text>` in their own `<Suspense>` (R3F)

Two drei components can **blank an entire subtree** while they load, and it's rarely obvious that loading is the cause.

- **`<Environment>` blocks model rendering in headless.** An HDR environment map download suspends. If the `<Environment>` shares a `<Suspense>` boundary with your model/physics content, the HDR download **blocks the models from rendering** until it resolves — which in a headless test (or a slow network) looks like nothing renders at all.

  > **Rule:** put `<Environment>` in a *separate* `<Suspense>` from your model/physics loader.

- **`<Text>` can suspend on font load and blank its parent subtree.** drei's `<Text>` suspends while its font loads; if it's inside the same boundary as your scene content, that whole subtree goes blank until the font arrives. On the app this blanked an entire 3D bracket once.

  > **Rule:** prefer HTML-anchored labels (`<Html>`) for UI text, or isolate `<Text>` in its own `<Suspense>`.

```tsx
<Canvas>
  {/* physics content in its own boundary */}
  <Suspense fallback={null}>
    <PhysicsScene />
  </Suspense>
  {/* HDR env in a SEPARATE boundary so it can't block the scene */}
  <Suspense fallback={null}>
    <Environment preset="city" />
  </Suspense>
</Canvas>
```

## The loader must supply every WASM env import

**Symptom:** `WebAssembly.instantiate` throws a `LinkError` at load — often something about a missing import like `emscripten_notify_memory_growth`.

**Cause:** the WASM is built with `ALLOW_MEMORY_GROWTH`, which requires the host to provide `emscripten_notify_memory_growth` (and the other env imports) or the link fails.

> **Rule:** the loader must supply **every** WASM env import. With `ALLOW_MEMORY_GROWTH`, `emscripten_notify_memory_growth: () => {}` is mandatory in the env imports or `WebAssembly.instantiate` throws a `LinkError`.

`box3d-web`'s loader already handles this — you don't wire env imports yourself. It also mints **fresh HEAP views on every access**, which is what makes memory growth safe: after the heap grows, a stale cached view would point at detached memory, but fresh-per-access getters never do. If you're writing your own loader against the raw module (you shouldn't need to), this is the trap.

## Verify FPS and animation on a REAL GPU

**Symptom:** your headless test reports impossible or meaningless frame rates, or animation appears frozen.

**Cause:** headless swiftshader (software WebGL) can't measure real FPS and throttles `requestAnimationFrame` when it isn't compositing. Any in-app "preview" that doesn't actually composite never fires rAF for these apps either.

> **Rule:** verify FPS / animation on a real GPU — `chromium.launch({ headless: false })`.

Headless-with-swiftshader is still correct for **functional** checks: reading a `window.__someState` bridge to assert body counts, awake counts, that the world loaded, that a click fired an impulse. Just not for **performance**. The split:

| Check | Headless swiftshader | Headed, real GPU |
|---|---|---|
| Did physics load? body counts? events fired? | ✓ | ✓ |
| Real FPS, frame pacing, smoothness | ✗ (throttled/meaningless) | ✓ |

Expose a DEV-gated debug bridge (`if (import.meta.env.DEV) window.__exampleState = {...}`) and assert measured runtime state — never assume "spec written = it works."

## Pin the InstancedMesh bounding sphere before raycasting

**Symptom:** click-to-pick against an `InstancedMesh` silently misses every click, even though the bodies are clearly on screen.

**Cause:** `InstancedMesh.raycast()` lazily computes a whole-mesh bounding sphere **once** and caches it. If that first compute happens before any instance matrix has been written — while the mesh still has effectively zero live matrices — the cached sphere collapses to roughly the origin, and every later raycast is rejected at the broadphase before it ever tests an instance.

> **Rule:** pin a static, generous `boundingSphere` up front so raycasts always reach the per-instance test.

```ts
import { Sphere, Vector3 } from 'three';

// generous sphere covering wherever bodies might end up
mesh.boundingSphere = new Sphere(new Vector3(0, 2, 0), 12);
```

Set it once after creating the mesh, sized to enclose the whole play area (including where bodies fly after a blast). Now the broadphase always passes and the raycast proceeds to the accurate per-instance test.

## `setState` per frame is the anti-pattern (R3F)

Not a crash, but the performance trap that undoes the whole buffer-oriented design.

> **Physics owns transforms; visuals stay in three.js.** Read transforms once per frame into an `InstancedMesh`; never `setState` per frame.

Driving positions through React state re-renders the tree every frame and throws away the point of the flat transform buffer. Use refs and `useFrame` (or `useFixedStep`), write matrices directly into the mesh, and keep React state for genuinely discrete UI changes only. The `r3f-box3d` hooks are built around this — `useFixedStep`'s `onAfterFrame` reads and syncs without touching state.

---

Most of these reduce to a single theme: **a WASM physics engine, an InstancedMesh, and React each have a quiet failure mode that renders nothing rather than erroring loudly.** Knowing the six above turns a mystifying black screen into a one-line fix.
