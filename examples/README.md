# Examples

Source-visible, independently deployable example pages — see `docs/plan.md`
Phase 2/3.

## `vanilla-three/` — plain three.js, zero framework

A multi-page Vite app (one gallery index + one page per demo). Each page is a
self-contained `index.html` + `main.ts`. Demonstrates the `box3d-web` core +
`three-box3d` adapter with no React.

- **Brick Stack** — settled wall, click-impulse (FixedStepper, TransformBuffer,
  SleepManager, InstancedMesh sync, radialImpulse).
- **Ball Drop** — spheres rain forever, capped by a `BodyPool`.
- **Raycast Pick** — click a body straight from the physics world.
- **Contact Pulse** — contact-begin events drive a per-instance color pulse.

```bash
npm run dev -w vanilla-three-examples   # http://127.0.0.1:5183
```

## `r3f-playground/` — declarative React Three Fiber

The `r3f-box3d` hooks proof: a settled Jenga-style brick tower you click to blast
apart, built entirely with `useBox3D` / `useWorld` / `useFixedStep` /
`useTransformBuffer` / `useInstancedTransforms`. Live HUD (bodies / awake / fps),
a "Blast center" button, and a Reset. **StrictMode is on** — the double-mount is
part of the proof. No per-frame `setState`; physics owns transforms.

```bash
npm run dev -w r3f-playground-example   # http://127.0.0.1:5184
```
