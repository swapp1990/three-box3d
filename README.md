# three-box3d

**3D physics for three.js, powered by [box3d](https://github.com/erincatto/box3d) (Erin Catto).**

`three-box3d` is the three.js and React Three Fiber integration layer for box3d, Erin Catto's 3D successor to Box2D. It provides a typed API, island-aware sleep management, InstancedMesh transform syncing, and a fixed-timestep runtime — the production-hardening a serious three.js physics integration needs, built and proven on a real deployed app.

> 🚧 **Pre-alpha, under active development.** The API is not stable yet. Expect breaking changes between minor versions until v1.0. Each release pins the wrapped box3d commit in the changelog.

box3d also has a raw WASM compile available independently as [`box3d-wasm`](https://www.npmjs.com/package/box3d-wasm) (by [monteslu](https://github.com/monteslu/box3d-wasm)) — a great option if you want the bare bindings. `three-box3d` is not a competing compile; it's the integration and ergonomics layer on top: typed handles, three.js-native helpers, and the hardening (sleep/island management, transform buffers, fixed-step accumulation) that a production three.js scene needs.

## Install

```bash
npm install box3d-web three-box3d three
# React Three Fiber layer (optional):
npm install r3f-box3d
```

## Quickstart — a brick wall + InstancedMesh

```ts
import { createBox3D, FixedStepper, TransformBuffer, SleepManager } from 'box3d-web';
import { writeTransformsToInstancedMesh } from 'three-box3d'; // adapter, separate pkg
import * as THREE from 'three';

const b3 = await createBox3D();                 // ← loud, explicit init
const world = b3.createWorld({ gravity: [0, -9.81, 0] });

// ground
const ground = world.createBody({ type: 'static' });
world.addBox(ground, [50, 0.5, 50], { friction: 0.8 });

// a 6×10 brick wall, tracked in one flat buffer (7 floats/body)
const buffer = new TransformBuffer(64);
const bricks = [];
for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 6; col++) {
    const body = world.createBody({
      type: 'dynamic',
      position: [col * 1.02 - 3, 0.5 + row * 0.52, 0],
    });
    world.addBox(body, [0.5, 0.25, 0.25], { density: 2, friction: 0.7 });
    bricks.push(body);
    buffer.add(body);
  }
}

// island-aware sleep so a settled wall costs ~0 step time
const sleep = new SleepManager(world, { sweepIntervalSec: 2, moveThreshold: 0.01 });
sleep.watch(bricks, buffer);

// three.js side: one InstancedMesh, material with vertexColors:FALSE
const geo = new THREE.BoxGeometry(1, 0.5, 0.5);
const mat = new THREE.MeshStandardMaterial(); // NB: vertexColors must stay false → else black instances
const mesh = new THREE.InstancedMesh(geo, mat, bricks.length);

const stepper = new FixedStepper();             // 1/60, 4 substeps, death-spiral clamp

function frame(delta) {
  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);
    sleep.forceSleepSettled();
    sleep.sweep(stepper.simTime);
  });
  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);                     // one bulk read: 7 floats/body
    writeTransformsToInstancedMesh(mesh, buffer); // one matrix write, one draw call
  }
}
// drive frame(delta) from your rAF / R3F useFrame loop — never setState per frame.
```

## Packages

| Package | npm | What it is |
|---|---|---|
| [`box3d-web`](packages/core) | `box3d-web` | Core WASM build + idiomatic typed TypeScript API. Framework-agnostic — no `three` dependency. |
| [`three-box3d`](packages/three) | `three-box3d` | The flagship three.js adapter: `Object3D` and `InstancedMesh` transform sync, physics raycasts from the camera. |
| [`r3f-box3d`](packages/react) | `r3f-box3d` | React Three Fiber hooks: `useBox3D`, `useWorld`, `useFixedStep`, `useTransformBuffer`, `useInstancedTransforms`, optional `<Physics>`. |

Dependency direction is strict: `r3f-box3d` → `three-box3d` → `box3d-web`. The core never imports `three`; the adapter takes `three` as a peer dependency.

## Docs

- **Getting Started, Concepts, and the Gotchas doc** live in [`docs-site/`](docs-site) — `npm run docs:dev` to serve locally.
- The **Gotchas** page is the part you want even if you don't use this library: the InstancedMesh `vertexColors` black-instance trap, the native-explode no-op on sleeping bodies, Suspense isolation for `<Environment>`/`<Text>`, the WASM env-import LinkError, and more — each one paid for in real debugging time.
- API reference is generated with TypeDoc (`npm run docs:api`).

## Examples

Source-visible, independently linkable pages in [`examples/`](examples): the brick-stack flagship, ball drop (BodyPool), raycast pick, contact pulse, and a declarative R3F playground. Run the vanilla gallery with `npm run dev -w vanilla-three-examples`.

The library is dogfooded on a live deployed app: [cars.swapp1990.org](https://cars.swapp1990.org) (`/wrecking-yard`, `/physics-playground`, `/worldcup`).

## Benchmarks

`npm run benchmark` measures step time vs body count (100–2000 falling boxes) and the sleep-sweep's effect on idle step time; the committed baseline lives at [`benchmarks/results/baseline.json`](benchmarks/results/baseline.json). Numbers are machine-specific — compare deltas, not absolutes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup, the native/WASM rebuild story, and PR expectations. Note that box3d upstream is pre-1.0 with PRs disabled; native-surface changes here mean editing `native/bridge.c` and recompiling.

## Credits

[box3d](https://github.com/erincatto/box3d) is written by Erin Catto and licensed MIT. `three-box3d` wraps a pinned box3d build (`box3d@v0.1.0`, Emscripten 6.0.2); it is not affiliated with or endorsed by the box3d project. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT © 2026 Swapnil Sawant (swapp1990). See [LICENSE](LICENSE).
