# three-box3d

3D physics for three.js, powered by box3d (Erin Catto).

`three-box3d` is the three.js and React Three Fiber integration layer for [box3d](https://github.com/erincatto/box3d), Erin Catto's 3D successor to Box2D. It provides a typed API, island-aware sleep management, InstancedMesh transform syncing, and a fixed-timestep runtime — the production-hardening a serious three.js physics integration needs, built and proven on a real deployed app.

> 🚧 **Pre-alpha, under active development.** The API is not stable yet. Expect breaking changes between minor versions until v1.0.

box3d also has a raw WASM compile available independently as [`box3d-wasm`](https://www.npmjs.com/package/box3d-wasm) (by [monteslu](https://github.com/monteslu/box3d-wasm)) — a great option if you want the bare bindings. `three-box3d` is not a competing compile; it's the integration and ergonomics layer on top: typed handles, three.js-native helpers, and the hardening (sleep/island management, transform buffers, fixed-step accumulation) that a production three.js scene needs.

## Packages

| Package | npm | What it is |
|---|---|---|
| [`box3d-web`](packages/core) | `box3d-web` | Core WASM build + idiomatic typed TypeScript API. Framework-agnostic — no `three` dependency. |
| [`three-box3d`](packages/three) | `three-box3d` | The flagship three.js adapter: `Object3D` and `InstancedMesh` transform sync, vanilla-JS friendly. |
| [`r3f-box3d`](packages/react) | `r3f-box3d` | React Three Fiber hooks: `useBox3D`, `useFixedStepWorld`, `useInstancedTransforms`, and more. |

All three packages are currently placeholders reserving their npm names ahead of the v0.1.0 release. See [`docs/plan.md`](docs/plan.md) for the full roadmap.

## Roadmap

The extraction and launch plan — market analysis, package architecture, phased delivery, and success metrics — lives at [`docs/plan.md`](docs/plan.md).

## Credits

[box3d](https://github.com/erincatto/box3d) is written by Erin Catto and licensed MIT. `three-box3d` wraps a pinned box3d build; it is not affiliated with or endorsed by the box3d project.

## License

MIT © 2026 Swapnil Sawant (swapp1990). See [LICENSE](LICENSE).
