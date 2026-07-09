---
layout: home

hero:
  name: three-box3d
  text: 3D physics for three.js
  tagline: Powered by box3d (Erin Catto). The production-hardened three.js & React Three Fiber layer — typed handles, island-aware sleep, InstancedMesh sync, fixed-timestep runtime.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why three-box3d?
      link: /guide/
    - theme: alt
      text: View on GitHub
      link: https://github.com/swapp1990/three-box3d

features:
  - icon: 🧱
    title: Buffer-oriented core
    details: No per-body JS object. One bulk read into a flat Float32Array (7 floats/body), synced to an InstancedMesh in a single draw call. Thousands of bodies, one mesh.
  - icon: 😴
    title: Island-aware sleep
    details: box3d sleeps islands, not bodies. The SleepManager force-sleeps settled spawns and sweeps idle structures so a settled wall costs ~0 step time.
  - icon: ⏱️
    title: Fixed-timestep, death-spiral safe
    details: A clamped accumulator with a catch-up cap. Slow frames never send the sim into a spiral it can't recover from.
  - icon: 🎯
    title: Typed handles, no singleton
    details: Branded WorldHandle / BodyHandle / ShapeHandle / JointHandle — compile-time safety, zero runtime cost. Multiple independent instances, always await createBox3D().
  - icon: ⚛️
    title: three.js & R3F native
    details: three-box3d for vanilla Object3D / InstancedMesh sync; r3f-box3d hooks for declarative React Three Fiber — refs and buffers, never setState per frame.
  - icon: 📓
    title: Hard-won gotchas, documented
    details: The vertexColors black-instance trap, the native-explode no-op, Suspense isolation for HDR/Text, the loader env-import LinkError — the things that cost real debugging time, written down.
---

## Install

```bash
npm install box3d-web three-box3d
# React Three Fiber layer (optional):
npm install r3f-box3d
```

## Three packages, three layers

| Package | npm | What it is |
|---|---|---|
| **`box3d-web`** | `box3d-web` | Framework-agnostic WASM core + typed API. No `three` import. |
| **`three-box3d`** | `three-box3d` | The flagship three.js adapter — `Object3D` / `InstancedMesh` sync. |
| **`r3f-box3d`** | `r3f-box3d` | React Three Fiber hooks: `useBox3D`, `useWorld`, `useFixedStep`, … |

> **Pre-alpha.** The API is not stable until v1.0; expect breaking changes between minor versions. Each release pins the wrapped box3d commit in the changelog.

`three-box3d` is **not** a competing WASM compile. box3d also has a raw binding, [`box3d-wasm`](https://www.npmjs.com/package/box3d-wasm) (by [monteslu](https://github.com/monteslu/box3d-wasm)) — great if you want the bare bindings. This is the integration and ergonomics layer on top.
