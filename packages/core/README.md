# box3d-web

Core WASM build + idiomatic typed TypeScript API for [box3d](https://github.com/erincatto/box3d) (Erin Catto) — **3D physics for the web**. Framework-agnostic: no `three` import anywhere, runs in the browser, a worker, or Node.

```bash
npm install box3d-web
```

## Loud, explicit init

There is no module singleton. You `await createBox3D()` and hold the result — the #1 support question in every WASM physics library ("why is physics `undefined`?") is designed out:

```ts
import { createBox3D } from 'box3d-web';

const b3 = await createBox3D();        // ← must be awaited before any world call
const world = b3.createWorld({ gravity: [0, -9.81, 0] });

const ground = world.createBody({ type: 'static' });
world.addBox(ground, [50, 0.5, 50], { friction: 0.8 });

const ball = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
world.addSphere(ball, 0.5, { density: 2, restitution: 0.3 });

world.step(1 / 60, 4);
```

## Design

- **Buffer-oriented, not object-oriented.** No `Body` class, no scene mirror. The per-frame read is one bulk copy into a flat `Float32Array` (7 floats/body: `[x,y,z, qx,qy,qz,qw]`) via `world.readTransforms` / `TransformBuffer.readInto`.
- **Handles, not objects.** `WorldHandle` / `BodyHandle` / `ShapeHandle` / `JointHandle` are branded opaque integers — compile-time type safety, zero runtime cost, zero allocation.
- **Right-handed, Y-up, meters/kg/seconds; quaternions `(x,y,z,w)`** — matches three.js conventions exactly.

## The six hardened helpers

Tree-shakeable named exports; none imports `three`:

| Helper | What it encodes |
|---|---|
| `FixedStepper` | Fixed-timestep accumulator with delta clamp + catch-up cap (death-spiral guard). |
| `TransformBuffer` | Packed id list + 7-float pose layout with dirty rebuild — the contract every renderer syncs from. |
| `SleepManager` | Island-aware sleep discipline: force-sleep settled spawns + periodic idle sweep. box3d sleeps *islands*, not bodies. |
| `radialImpulse` | The explode workaround — native `b3World_Explode` is a no-op on sleeping bodies; this wakes and pushes with falloff + upward bias. |
| `BodyPool` | Capped transient-body pool (debris/projectiles), evicts the oldest. Experimental in v0.1. |
| `probeCapabilities` | Feature-probe for optional native exports — helpers degrade gracefully on older builds. |

## Rendering

Pair with [`three-box3d`](https://www.npmjs.com/package/three-box3d) (Object3D / InstancedMesh sync) or [`r3f-box3d`](https://www.npmjs.com/package/r3f-box3d) (React Three Fiber hooks). Docs, gotchas, and examples: https://github.com/swapp1990/three-box3d

Status: v0.1 — single-threaded, same-build reproducible determinism (see the docs for the exact claim). Wraps `box3d@v0.1.0`, built with Emscripten 6.0.2 (`-DBOX3D_DISABLE_SIMD -ffp-contract=off`). MIT.
