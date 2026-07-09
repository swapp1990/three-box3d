# r3f-box3d

React Three Fiber hooks for [box3d](https://github.com/erincatto/box3d) —
3D physics for R3F, powered by box3d (Erin Catto). Built on
[three-box3d](https://www.npmjs.com/package/three-box3d) +
[box3d-web](https://www.npmjs.com/package/box3d-web).

Hooks-first and thin: **refs and buffers, never `setState` per frame.** Physics
owns transforms; visuals stay in three.js. No ECS, no scene mirror, no per-body
reactive wrapper — the whole point of box3d's flat transform buffer is that it
syncs to an `InstancedMesh` for the price of one draw call.

```bash
npm install r3f-box3d box3d-web three-box3d three @react-three/fiber react
```

Peer deps: `@react-three/fiber ^9 || ^8`, `react >=18`, `three >=0.159`.

## Hooks

| Hook | What it does |
|---|---|
| `useBox3D(options?)` | Load the WASM module, **Suspense-integrated** — throws a cached promise until ready (drei `useGLTF` pattern). Wrap the tree in `<Suspense>`. |
| `useBox3DAsync(options?)` | Non-suspending escape hatch → `{ box3d, loading, error }`. Render your own fallback. |
| `useWorld(box3d, options?)` | A `World` tied to the component lifecycle. Created in an effect, destroyed on unmount. **StrictMode-safe.** Returns `null` until ready. |
| `useFixedStep(world, options?)` | Drives `world.step` on a fixed-timestep accumulator inside `useFrame` (1/60, 4 substeps, death-spiral guard). `onStep` for per-step work, `onAfterFrame(stepped)` for the once-per-frame transform sync. |
| `useTransformBuffer(bodies, capacity?)` | A stable `TransformBuffer` that repacks when the tracked body set changes. |
| `useInstancedTransforms(meshRef, buffer, opts?)` | Returns a `sync()` that bulk-writes the buffer into an `InstancedMesh` — call it from `onAfterFrame`. No re-render. |
| `<Physics>` / `usePhysics()` | **Optional** shared-world provider (rapier-style). Everything above works without it. |

The core helpers (`FixedStepper`, `TransformBuffer`, `SleepManager`,
`radialImpulse`, `BodyPool`, `probeCapabilities`) and the common types are
re-exported for convenience, so most apps import only from `r3f-box3d`.

## StrictMode & Suspense

- **`useBox3D` suspends.** The WASM load is async; on first render the hook throws
  a cached promise so `<Suspense fallback>` shows until physics is ready. One
  module is shared across every component and across StrictMode's double render.
  Use `useBox3DAsync` when you can't add a Suspense boundary.
- **`useWorld` is StrictMode-safe.** It creates the world in an effect and
  publishes it via state, so React 18/19 dev StrictMode (effect runs
  mount → cleanup → mount) always leaves exactly one live world — no leak, no
  use-after-destroy. Because the world arrives after first render, create
  bodies/shapes in your own effect keyed on the world, not during render.

## Quickstart

```tsx
import { Canvas } from '@react-three/fiber';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  useBox3D, useWorld, useFixedStep, useTransformBuffer, useInstancedTransforms,
  SleepManager, type BodyHandle,
} from 'r3f-box3d';

function Bricks() {
  const box3d = useBox3D();                        // suspends until ready
  const world = useWorld(box3d, { gravity: [0, -9.81, 0] });
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [bricks, setBricks] = useState<BodyHandle[]>([]);

  useEffect(() => {
    if (!world) return;
    const ground = world.createBody({ type: 'static' });
    world.addBox(ground, [30, 0.5, 30], { friction: 0.85 });
    const made: BodyHandle[] = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 6; col++) {
        const b = world.createBody({ type: 'dynamic', position: [(col - 2.5) * 1.04, 0.5 + row * 0.52, 0] });
        world.addBox(b, [0.5, 0.25, 0.28], { density: 2, friction: 0.7 });
        made.push(b);
      }
    setBricks(made);
  }, [world]);

  const buffer = useTransformBuffer(bricks, 64);
  const sync = useInstancedTransforms(meshRef, buffer);
  const sleep = useRef<SleepManager>();
  useEffect(() => {
    if (!world || bricks.length === 0) return;
    sleep.current = new SleepManager(world, { sweepIntervalSec: 1.5 });
    sleep.current.watch(bricks, buffer);
  }, [world, bricks, buffer]);

  const stepper = useFixedStep(world, {
    onStep: () => { sleep.current?.forceSleepSettled(); sleep.current?.sweep(stepper?.simTime ?? 0); },
    onAfterFrame: (stepped) => { if (stepped && world) { buffer.readInto(world); sync(); } },
  });

  // vertexColors stays FALSE — else setColorAt renders black instances.
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, 48]} castShadow>
      <boxGeometry args={[1, 0.5, 0.56]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

export default function App() {
  return (
    <Canvas shadows>
      <Suspense fallback={null}><Bricks /></Suspense>
    </Canvas>
  );
}
```

See `examples/r3f-playground/` in the monorepo for a polished, verified page
(settled brick tower, click-to-blast, live HUD, reset).

Status: v0.1 — see the monorepo's `docs/api-design.md` for the frozen `box3d-web`
contract these hooks build on.
