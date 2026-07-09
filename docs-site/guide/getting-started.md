# Installation & Quickstart

## Install

```bash
npm install box3d-web three-box3d three
```

`three` is a **peer dependency** of `three-box3d` (`>=0.159`) — install it yourself so you control the version. `box3d-web` has zero runtime dependencies and ships the WASM binary inside the package.

For the React Three Fiber layer, add `r3f-box3d` (which brings `three-box3d` transitively) alongside your React / R3F install:

```bash
npm install r3f-box3d @react-three/fiber react react-dom
```

## Load loudly: `await createBox3D()`

WASM physics is asynchronous to initialize. The single most common support question across every WASM physics library is *"why is `physics` undefined?"* — the answer is almost always a missing `await`. So `box3d-web` makes the async step impossible to skip: there is **no module singleton and no lazy global**. You call `createBox3D()`, you `await` it, and you hold the result.

```ts
import { createBox3D } from 'box3d-web';

const b3 = await createBox3D();          // ← must be awaited before ANY world call
const world = b3.createWorld({ gravity: [0, -9.81, 0] });
```

`createBox3D()` loads and instantiates the WASM, wires every environment import, and runs the module's `_initialize`. It **rejects** (never resolves `null`) on a load or link failure, with a message naming the likely cause. Multiple independent instances — and multiple worlds per instance — are fully supported.

::: tip Top-level await
`await createBox3D()` at module top level requires an `es2022` (or later) build target. See [Bundler notes](./bundlers).
:::

## Hero walkthrough — a brick wall + InstancedMesh

The canonical example: a settled brick wall, tracked in one flat buffer, synced to a single `InstancedMesh`, with island-aware sleep so the idle wall costs almost nothing. Reads top to bottom in about 40 lines, and the three shipping hazards (explicit `await`, `vertexColors: false`, no per-frame `setState`) surface as inline comments.

```ts
import { createBox3D, FixedStepper, TransformBuffer, SleepManager } from 'box3d-web';
import { writeTransformsToInstancedMesh } from 'three-box3d'; // adapter, separate pkg
import * as THREE from 'three';

const b3 = await createBox3D();                 // ← loud, explicit init
const world = b3.createWorld({ gravity: [0, -9.81, 0] });

// ground
const ground = world.createBody({ type: 'static' });
world.addBox(ground, [50, 0.5, 50], { friction: 0.8 });

// a 6×10 brick wall, tracked in one flat buffer
const buffer = new TransformBuffer(64);
const bricks: number[] = [];
for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 6; col++) {
    const body = world.createBody({
      type: 'dynamic',
      position: [col * 1.02 - 3, 0.5 + row * 0.52, 0],
    });
    world.addBox(body, [0.5, 0.25, 0.25], { density: 2, friction: 0.7 });
    bricks.push(body);
    buffer.add(body as any);
  }
}

// island-aware sleep so a settled wall costs ~0 step time
const sleep = new SleepManager(world, { sweepIntervalSec: 2, moveThreshold: 0.01 });
sleep.watch(bricks as any, buffer);

// three.js side: one InstancedMesh, material with vertexColors:FALSE
const geo = new THREE.BoxGeometry(1, 0.5, 0.5);
const mat = new THREE.MeshStandardMaterial(); // NB: vertexColors must stay false → else black instances
const mesh = new THREE.InstancedMesh(geo, mat, bricks.length);

const stepper = new FixedStepper();             // 1/60, 4 substeps, 3-step death-spiral clamp

function frame(delta: number) {
  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);
    sleep.forceSleepSettled();
    sleep.sweep(stepper.simTime);
  });
  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);                     // one bulk read: 7 floats/body
    writeTransformsToInstancedMesh(mesh, buffer); // adapter does the matrix write
  }
}
// drive frame(delta) from your rAF loop — never setState per frame.
```

::: warning The one API to get right
`writeTransformsToInstancedMesh(mesh, buffer)` takes the **buffer object** (which exposes `.ids`, `.transforms`, `.count`), not `buffer.ids, buffer.transforms` as two arguments. An older draft used the split-argument form — the shipped adapter takes the whole buffer, plus an optional `{ hide, startIndex }` options object.
:::

## React Three Fiber

The same scene with `r3f-box3d` hooks — suspend on init, drive the loop with `useFixedStep`, sync with `useInstancedTransforms`, no per-frame `setState`:

```tsx
import { Canvas } from '@react-three/fiber';
import { Suspense, useRef, useState } from 'react';
import {
  useBox3D, useWorld, useFixedStep, useTransformBuffer, useInstancedTransforms,
  type BodyHandle,
} from 'r3f-box3d';
import * as THREE from 'three';

function Bricks() {
  const b3 = useBox3D();                          // suspends until WASM ready
  const world = useWorld(b3, { gravity: [0, -9.81, 0] });
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [bricks] = useState<BodyHandle[]>(() => /* build ground + wall here */ []);

  const buffer = useTransformBuffer(bricks, 64);
  const sync = useInstancedTransforms(meshRef, buffer);

  useFixedStep(world, {
    onAfterFrame: (stepped) => {
      if (world && stepped > 0) { buffer.readInto(world); sync(); }
    },
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, 64]} castShadow>
      <boxGeometry args={[1, 0.5, 0.5]} />
      {/* vertexColors stays false */}
      <meshStandardMaterial />
    </instancedMesh>
  );
}

export function App() {
  return (
    <Canvas shadows camera={{ position: [8, 6, 9] }}>
      <ambientLight intensity={0.3} />
      <directionalLight position={[6, 12, 4]} castShadow />
      <Suspense fallback={null}>
        <Bricks />
      </Suspense>
    </Canvas>
  );
}
```

`useBox3D()` **suspends** until the WASM is ready — the R3F-idiomatic equivalent of the vanilla `await`. Wrap the physics subtree in `<Suspense>`.

## Next

- **[Bundler notes](./bundlers)** — WASM asset handling, the `separate` vs `compat` builds, the `es2022` target.
- **[Gotchas](./gotchas)** — read before you ship. The `vertexColors` trap and the native-explode no-op will bite otherwise.
