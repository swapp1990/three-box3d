# Examples

Every example is a **source-visible, independently linkable page** — a self-contained `index.html` + `main.ts` (or a small React app) with a "View source" link in the corner. The examples are the product: each one demonstrates a specific capability with the real, copy-pasteable integration pattern.

The gallery deploys from `examples/` in the repo. Run it locally with:

```bash
npm install
npm run build              # build the workspace packages first
npm run dev -w vanilla-three-examples    # vanilla gallery on :5183
npm run dev -w r3f-playground-example    # r3f playground on :5184
```

## Vanilla three.js

Plain three.js, zero framework — `box3d-web` + `three-box3d` only.

| Example | What it demonstrates |
|---|---|
| **Brick Stack** | The flagship. A settled 8×6 masonry wall you can click-impulse apart. `FixedStepper`, `TransformBuffer`, `SleepManager` (island-aware sleep — the idle wall costs ~0 step time), InstancedMesh sync, and `radialImpulse` (the native-explode workaround). |
| **Ball Drop** | Spheres rain forever, capped by a `BodyPool` that evicts the oldest ball at the cap. Fixed-size InstancedMesh with hidden-slot parking via `hiddenInstanceMatrix`. |
| **Raycast Pick** | Click to pick a body straight from the **physics world** via `raycastFromCamera` (no render-side raycast at all), then launch it with an impulse at the hit point. |
| **Contact Pulse** | Tumbling cubes flash on impact — `drainContactBeginEvents` drives a per-instance color pulse scaled by `approachSpeed`. Also the canonical *correct* use of `setColorAt` (with `vertexColors` left false). |

Source: [`examples/vanilla-three/`](https://github.com/swapp1990/three-box3d/tree/main/examples/vanilla-three)

## React Three Fiber

| Example | What it demonstrates |
|---|---|
| **R3F Playground** | A Jenga-style brick tower built declaratively with the `r3f-box3d` hooks: `useBox3D` (Suspense-gated init), `useWorld` (StrictMode-safe lifecycle), `useFixedStep`, `useTransformBuffer`, `useInstancedTransforms`. Click to blast, live HUD, reset — StrictMode ON, zero per-frame `setState`. |

Source: [`examples/r3f-playground/`](https://github.com/swapp1990/three-box3d/tree/main/examples/r3f-playground)

## Production dogfood

The library is extracted from — and still powers — a live deployed app: [cars.swapp1990.org](https://cars.swapp1990.org) runs box3d demolition scenes at `/wrecking-yard`, `/physics-playground`, and `/worldcup`. The hardening in these packages (island sleep discipline, transform buffers, the fixed-step guard, the radial-impulse workaround) was debugged there first.
