# Introduction

`three-box3d` is the three.js and React Three Fiber integration layer for [box3d](https://github.com/erincatto/box3d), Erin Catto's 3D successor to Box2D.

box3d is a small, fast, deterministic C physics solver — the same lineage as Box2D, whose reputation (simple API, great continuous collision, tiny footprint) has no good 3D-for-web equivalent yet. Compiling it to WASM is the easy part. The hard part — the part that costs real debugging time — is everything above the compile step: keeping a settled structure asleep, syncing thousands of transforms to an InstancedMesh without allocating, surviving a slow frame without a fixed-step death spiral, and dodging the handful of three.js/R3F traps that turn a working demo into a black screen.

That layer is what this project ships, hardened on a live deployed app.

## The three packages

- **`box3d-web`** — the framework-agnostic core. Loads the WASM, exposes a typed handle API, and ships six tree-shakeable runtime helpers (`FixedStepper`, `TransformBuffer`, `SleepManager`, `radialImpulse`, `BodyPool`, `probeCapabilities`). It never imports `three`.
- **`three-box3d`** — the flagship three.js adapter. Copies the core's flat transform buffers into `Object3D` / `InstancedMesh`, and casts a camera ray into the physics world. `three` is a peer dependency.
- **`r3f-box3d`** — React Three Fiber hooks (`useBox3D`, `useWorld`, `useFixedStep`, `useTransformBuffer`, `useInstancedTransforms`) plus an optional `<Physics>` provider. Refs and buffers, never `setState` per frame.

The dependency direction is strict, copied from `@react-three/rapier`'s shape: `r3f-box3d` → `three-box3d` → `box3d-web`. You only pull in what you use.

## Design in one breath

- **Buffer-oriented, not object-oriented.** There is deliberately no `Body` class and no scene mirror. The read path is one bulk copy into a `Float32Array`, read once per frame. This is the whole reason the InstancedMesh story is cheap.
- **Handles, not objects.** Worlds, bodies, shapes and joints are branded opaque integers — compile-time-safe, zero runtime cost, zero allocation.
- **Physics owns transforms; visuals stay in three.js.** The core produces buffers; the adapter writes them into meshes. `setState`-per-frame is an anti-pattern we design against.
- **Explicit async init, loud everywhere.** `const b3 = await createBox3D()`. No module singleton, no lazy global. "Why is physics `undefined`?" is the #1 support question in every WASM physics library — so every quickstart leads with the `await`.

## Where to go next

- **[Installation & Quickstart](./getting-started)** — install, `await createBox3D()`, a brick wall in ~40 lines.
- **[Bundler notes](./bundlers)** — the WASM asset, top-level await, and the `es2022` target.
- **[Concepts](/concepts/architecture)** — worlds, handles and buffers; the fixed step; island sleeping; the determinism caveat.
- **[Gotchas](./gotchas)** — the hard-won rules. Read this before you ship.
- **[Examples](./examples)** — the source-visible gallery.
