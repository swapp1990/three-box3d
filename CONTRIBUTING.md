# Contributing to three-box3d

Thanks for your interest! PRs are welcome — this document covers the dev setup, the layout, and what a good PR looks like.

## Dev setup

```bash
git clone https://github.com/swapp1990/three-box3d
cd three-box3d
npm install          # npm workspaces monorepo (Node 20+ / npm 10+)
npm run build        # builds box3d-web → three-box3d → r3f-box3d (order matters)
npm test             # vitest across all three packages (runs the real WASM in Node)
npm run typecheck    # tsc --noEmit across all workspaces
```

Useful during development:

```bash
npm run dev -w vanilla-three-examples   # vanilla example gallery on http://127.0.0.1:5183
npm run dev -w r3f-playground-example   # R3F playground
npm run docs:dev                        # VitePress docs site
npm run benchmark                       # step-time benchmark (build first)
```

## Repo layout

```
packages/core    box3d-web    — WASM loader, typed API, six runtime helpers. No three import.
packages/three   three-box3d  — three.js adapter (Object3D/InstancedMesh sync, raycast).
packages/react   r3f-box3d    — React Three Fiber hooks.
examples/        source-visible example pages (the gallery).
native/          bridge.c + build script + the pinned box3d source recipe.
docs-site/       VitePress docs. docs-site/api is TypeDoc-generated, not committed.
benchmarks/      npm run benchmark harness + committed baseline.
```

## The native/WASM boundary (read before touching physics internals)

The WASM binary at `packages/core/wasm/box3d.wasm` is **prebuilt and committed**. JavaScript can only call functions that were in `EXPORTED_FUNCTIONS` at compile time — so adding any new native capability means:

1. Edit `native/bridge.c` (all native surface goes through the bridge — never expose raw box3d symbols).
2. Recompile with the **pinned toolchain**: Emscripten 6.0.2, flags as in `native/scripts/build-wasm.sh` (notably `-DBOX3D_DISABLE_SIMD -ffp-contract=off` for determinism).
3. Update `native/expected-exports.txt` and the loader/typings.
4. **Over-export a little** while you're at it — a second native rebuild is far more expensive than an unused export.

If you can't run the Emscripten toolchain, open the PR with the `bridge.c` diff and the JS side gated behind `Capabilities` — a maintainer will produce the binary. Never hand-edit the `.wasm`.

box3d upstream is pre-1.0 and has **PRs disabled** (issues/Discord only) — engine bugs go to [erincatto/box3d issues](https://github.com/erincatto/box3d/issues), not here. This repo pins the wrapped box3d commit per release.

## PR expectations

- **Tests.** Behavior changes need a test. The core suite runs the real WASM in Node — no mocks of the engine. When a test fails, fix the code, not the assertion.
- **Types are API.** The public `.d.ts` surface is reviewed deliberately; breaking changes to frozen v0.1 signatures need a strong reason and a changeset marking a breaking bump.
- **No new runtime dependencies** in `packages/*` without prior discussion — `box3d-web` ships with zero, and the examples budget is "three + the workspace packages".
- **Changesets.** Any user-visible change needs one: `npx changeset` (the three packages version together). Docs-only and CI-only changes don't.
- **Conventional-ish commits** (`feat(core): …`, `fix(three): …`, `docs: …`) keep the history greppable.
- **Visual/perf claims need measurement.** If your change affects frame time or rendering, verify on a real GPU (headed browser) — headless swiftshader FPS numbers are meaningless. Functional checks are fine headless via the examples' DEV-gated `window.__exampleState` bridges.

## Code style

TypeScript strict, ESM with `.js` import specifiers in source, 2-space indent, single quotes. Match the file you're editing. Comments explain *why* (especially anything that encodes a hard-won gotcha — those comments are load-bearing documentation).

## Releasing (maintainers)

Changesets drives versioning and publish: merge the release PR that `changeset version` opens; `changeset publish` runs from CI. Every release changelog pins the wrapped box3d commit + Emscripten version. Publishing is dormant until the v0.1.0 launch.
