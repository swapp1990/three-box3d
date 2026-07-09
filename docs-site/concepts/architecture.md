# Architecture

`three-box3d` is three packages in three layers, with a strict one-way dependency direction copied from `@react-three/rapier`. You pull in only the layers you use.

```
┌──────────────────────────────────────────────┐
│  r3f-box3d            (npm: r3f-box3d)         │  React Three Fiber hooks:
│  useBox3D, useWorld, useFixedStep,            │  declarative, refs + buffers,
│  useTransformBuffer, useInstancedTransforms,  │  never setState per frame
│  <Physics>                                    │
└───────────────────────┬──────────────────────┘
                        │ depends on
┌───────────────────────▼──────────────────────┐
│  three-box3d          (npm: three-box3d)      │  three.js adapter:
│  applyTransformToObject3D,                    │  Object3D + InstancedMesh sync,
│  writeTransformsToInstancedMesh,              │  raycastFromCamera.
│  hiddenInstanceMatrix, raycastFromCamera      │  three is a PEER dep
└───────────────────────┬──────────────────────┘
                        │ depends on
┌───────────────────────▼──────────────────────┐
│  box3d-web            (npm: box3d-web)         │  WASM + typed TS API:
│  createBox3D(), World, branded handles,       │  loader, typed handles,
│  FixedStepper, TransformBuffer, SleepManager, │  six tree-shakeable helpers.
│  radialImpulse, BodyPool, probeCapabilities   │  NO three import anywhere
└───────────────────────┬──────────────────────┘
                        │ built from
┌───────────────────────▼──────────────────────┐
│  native/  bridge.c + box3d@<pinned commit>    │  Emscripten build →
│  → box3d.wasm + loader                        │  box3d.wasm (committed)
└──────────────────────────────────────────────┘
```

## Dependency rules

- **`box3d-web`** has zero runtime dependencies and ships the WASM. It never imports `three`. This is what lets it run in a worker, in Node, or behind a non-three renderer.
- **`three-box3d`** depends on `box3d-web`; `three` is a **peer dependency** (`>=0.159`) so you control the version.
- **`r3f-box3d`** depends on `three-box3d`; its peer deps are `@react-three/fiber ^9`, `react ^19`, `three >=0.159`.

The direction never reverses: the core knows nothing about three.js, and three.js knows nothing about React. A vanilla three.js app imports two packages; a React app imports one (and gets the rest transitively).

## Why the split matters

The core is deliberately renderer-agnostic because the **hard-won hardening lives there**, not in the rendering glue. The fixed-step accumulator, the island-aware sleep discipline, the flat transform buffer, the radial-impulse explode workaround — none of them touch `three`. That means:

- You can unit-test the physics without a WebGL context (the core's test suite runs the real WASM in Node).
- You can run the sim on a worker thread and post transform buffers to the main thread.
- If you ever swap renderers, only the thin adapter layer changes.

## The native boundary

box3d is pre-1.0 and its maintainer has **PRs disabled** (issues/Discord only). So this project maintains its own C bridge (`bridge.c`) and pins the exact box3d commit per release. All native surface — every function JS can call — is isolated behind that bridge, compiled to WASM with a pinned Emscripten toolchain.

The practical consequence for you: **a box3d version bump is one recompile plus one changeset**, never a scramble across the codebase. Every release changelog line names the wrapped commit — *"wraps box3d@&lt;commit&gt;, built with Emscripten 6.0.2."*
