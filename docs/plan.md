# box3d + three.js — Open-Sourcing Strategy

**Scope:** Extract this repo's box3d WASM + three.js physics integration into a standalone MIT-licensed OSS monorepo, from repo creation through launch and sustained maintenance.

---

## 1. Executive summary

box3d (Erin Catto's 3D successor to Box2D) went public ~2026-06-30 and has 4,741 stars in weeks. It is MIT, alpha, pre-1.0. The "first WASM binding" slot is already gone: `box3d-wasm` (monteslu, npm, repo created 2026-07-02) beat us by ~1 week, and a second demo effort exists. But both are demo-level — raw bindings plus a three.js scene, no packaged declarative R3F layer, thin types, and **zero production hardening**.

**The opportunity is the layer above the compile step, not the compile step.** This repo already paid, in real debugging time, for the exact things a serious three.js/R3F physics library needs and neither competitor has: an island-aware sleep manager, an InstancedMesh transform buffer, a fixed-timestep death-spiral guard, a radial-impulse explode workaround for a native no-op, a kinematic drag-joint pattern, and a hand-designed typed API. Those are documented in `.claude/CLAUDE.md` as "hard-won rules" — they become the public gotchas doc.

**One-sentence pitch:** *`three-box3d` — the production-hardened three.js + React Three Fiber layer for the box3d physics engine.*

**Positioning:** NOT "box3d compiled to WASM" (commoditized). We are the integration-quality and ergonomics layer, with respectful box3d-wasm interop as a fallback, not a war.

**Why now:** box3d is 2 months old and the niche is visibly hot (two independent efforts in one week). Box2D's reputation — simple deterministic C solver, great CCD, tiny footprint — has no good 3D-for-web equivalent. We hold hardening nobody else has published. The window to plant the flagship name (`three-box3d`, available) and court pmndrs is now, before box3d-wasm ships its own R3F layer.

---

## 2. Market reality

### License verdict — non-issue

box3d is standard permissive MIT (© 2026 Erin Catto), same as Box2D v3. WASM builds and wrapper libraries are explicitly permitted; no restrictions beyond MIT attribution. We ship MIT to match (Box2D/box3d precedent, simplest, matches what the audience expects). Third-party notices already in the vendored tree we must aggregate: `extern/sokol` (zlib, © 2018 Andre Weissflog — samples-only, likely excludable), `samples/jsmn.h` and `samples/tiny_obj_loader.h` (samples-only). Emscripten runtime bits are Emscripten-authors licensed. **Action:** ship a `THIRD_PARTY_NOTICES.md` aggregating box3d MIT + any linked-in third-party; exclude the `samples/` tree from the build so sokol/jsmn/tiny_obj never link.

### Prior art

| Effort | What it is | Status | Gap vs. us |
|---|---|---|---|
| `box3d-wasm` (monteslu) | npm v0.2.0, repo 2026-07-02, 12★. SIMD + optional threads, `World`/`Body`/shape/joint API with `{x,y,z}` objects, threaded + non-threaded builds, live three.js demo (ragdolls, dominoes, buggy) | Active, ahead on the raw compile | No packaged R3F layer, no hardening (sleep/island mgmt, InstancedMesh sync), demo-level types |
| ikekou box3d-demos | Pages site: castle/crane/kaiju/bench, box3d + three.js + Emscripten | Demo-only | Not packaged at all |
| Box.com `.box3d` | Unrelated 3D-preview file format | N/A | SEO collision only — mitigate with tagline |

**box3d-wasm is a real competitor and moving fast.** Treat it as the reference for the raw-compile flavor and, ideally, an interop target — our core can optionally wrap their module rather than only our own bridge. Do not try to out-compile them; out-integrate them.

### Competitor landscape (condensed)

| Library | License | Stars (core/js/r3f) | Note |
|---|---|---|---|
| Rapier + @react-three/rapier | Apache-2.0 | 5,502 / 696 / 1,409 | Rust→WASM, determinism variant, best docs, most popular R3F choice; heavy payload (rapier3d-compat unpacks 8.2MB). **This is the shape to copy.** |
| Jolt (JoltPhysics.js) | MIT | 10,679 / 538 | AAA pedigree, official three.js addon, thin web mindshare, 7-flavor WASM matrix |
| ammo.js (Bullet) | zlib-ish | 4,529 | Raw embind port, huge, unmaintained — the thing people flee |
| cannon-es | MIT | 2,034 | Pure JS, stalled; pmndrs says don't start new projects on it |
| Havok | MIT (web) | — | Babylon-flavored; needs WASM SIMD |

**The gap:** a lean, deterministic, three.js/R3F-native box3d binding with real docs, hand-authored types, and hardening. Legitimately unclaimed — if we out-execute box3d-wasm on integration and ergonomics.

### Why we can win / how we could lose

**Win:** (1) Hardening moat is genuinely hard-won and undocumented elsewhere. (2) `three-box3d` name is available and describes the flagship value. (3) pmndrs precedent (rapier's R3F layer was adopted → massive distribution) is a repeatable path. (4) We have a live dogfood showcase already deployed (cars.swapp1990.org: /wrecking-yard, /physics-playground, /worldcup). (5) Box2D's brand equity transfers to box3d — riding a rising engine.

**Lose:** (1) box3d-wasm ships an R3F layer before we launch and captures the name-recognition. Mitigation: move fast to Phase 3 dogfood proof, launch on integration quality not features. (2) Upstream API churn — box3d is pre-1.0, **PRs are disabled** (maintainer wants issues/Discord), so we maintain our own bridge and eat every breaking native change. Mitigation: pin the native commit per release, isolate all native surface behind `bridge.c`. (3) Solo-maintainer burnout — mitigate with heavy CI automation and agent-driven maintenance. (4) We over-invest in the core (commoditized) instead of the layer (our moat).

---

## 3. Product definition

### Package architecture (3 layers)

```
                      ┌─────────────────────────────────────┐
   peer: three        │  @box3d/react   (r3f-box3d on npm)   │   R3F hooks:
   peer: @react-three │  useBox3D, useFixedStepWorld,        │   declarative,
   peer: react        │  useInstancedTransforms, <Physics>   │   pmndrs-aspirant
                      └───────────────┬─────────────────────┘
                                      │ depends on
                      ┌───────────────▼─────────────────────┐
   peer: three        │  three-box3d   (FLAGSHIP)            │   three.js adapter:
                      │  applyTransformToObject3D,           │   Object3D +
                      │  writeTransformsToInstancedMesh,     │   InstancedMesh sync,
                      │  hidden-instance matrix helpers      │   vanilla examples
                      └───────────────┬─────────────────────┘
                                      │ depends on
                      ┌───────────────▼─────────────────────┐
   NO framework dep   │  @box3d/core   (box3d-web on npm)    │   WASM + idiomatic TS:
                      │  createBox3D(), typed handles,       │   loader, typed API,
                      │  fixed-step, sleep-mgr, transform-   │   sleep/step/transform
                      │  buffer, radial-impulse, body-pool   │   helpers, no singleton
                      └───────────────┬─────────────────────┘
                                      │ built from
                      ┌───────────────▼─────────────────────┐
                      │  native/  bridge.c + box3d@<pinned>  │   Emscripten build,
                      │  → box3d.wasm + box3d.js loader      │   26+ exports
                      └──────────────────────────────────────┘
```

**Dependency rules (copied from @react-three/rapier's shape):**
- `@box3d/core`: zero runtime deps; ships the WASM. No `three` import anywhere.
- `three-box3d`: depends on `@box3d/core`; `three` is a **peer dep** (`>=0.159`).
- `@box3d/react`: depends on `three-box3d`; peer deps `@react-three/fiber ^9`, `react ^19`, `three >=0.159`.

### npm naming (recommended, all verified available 2026-07-08)

| Package | npm name | Rationale |
|---|---|---|
| Flagship three.js adapter | **`three-box3d`** | Available; the `three-mesh-bvh` / `three-*` convention signals "three.js addon for X"; describes the value directly; the name people will search |
| Core (framework-agnostic) | **`box3d-web`** | Available; `box3d` bare is available too but too close to upstream/Box.com — `box3d-web` disambiguates the WASM-for-browser core without claiming the engine name |
| React layer | **`r3f-box3d`** | Available; short, unambiguous. **Aspiration:** migrate to `@react-three/box3d` scope if pmndrs adopts (that scope belongs to them — do not squat it) |

Use npm scope `@box3d/*` internally in the monorepo for `core`/`react` if we prefer scoped publishing; the public flagship stays unscoped `three-box3d` for discoverability. Tagline everywhere to dodge Box.com SEO: *"3D physics for three.js, powered by box3d (Erin Catto)."*

### v0.1 (MVP) vs v0.5 vs v1.0 — tied to the extraction map's API gaps

The current `bridge.c` exports **26** `b3bridge_*` functions (the saved build log lists only 19 — an export-drift bug to fix in Phase 0). Per the repo's own rule, **over-export when recompiling** — it's cheaper than a second native build. Each API-completeness gap below requires editing `vendor/box3d-experiment/bridge.c` and recompiling with Emscripten.

| Capability | Current | v0.1 | v0.5 | v1.0 |
|---|---|---|---|---|
| world/body/step, box/sphere/capsule shapes | ✅ | ✅ | ✅ | ✅ |
| impulse, linear velocity, kinematic target | ✅ | ✅ | ✅ | ✅ |
| spherical / revolute / distance joints | ✅ | ✅ | ✅ | ✅ |
| raycast closest, contact + sensor events | ✅ | ✅ | ✅ | ✅ |
| bulk `readTransforms` (7 floats/body) | ✅ | ✅ | ✅ | ✅ |
| hardening: fixed-step, sleep-mgr, transform-buffer, radial-impulse, body-pool | ✅ (app) | ✅ (extracted) | ✅ | ✅ |
| **destroyJoint** (missing — forces the drag-joint destroy-hand-body hack) | ❌ | ✅ **(add to bridge.c)** | ✅ | ✅ |
| typed handles (`WorldHandle`/`BodyHandle`/`ShapeHandle`/`JointHandle`) | ❌ (all `number`) | ✅ | ✅ | ✅ |
| body transform setters, angular velocity, forces/torques | ❌ | — | ✅ | ✅ |
| collision filters / query filters, user data | ❌ | — | ✅ | ✅ |
| more joints (prismatic/weld/motor), material updates | ❌ | — | ✅ | ✅ |
| mesh / heightfield colliders, non-box sensors | ❌ | — | — | ✅ |
| event streaming without per-event object allocation | ❌ | — | ✅ | ✅ |
| determinism story: documented + CI-verified | ❌ | documented caveat | single-thread reproducible | cross-run/platform CI test |

**Determinism story.** Build with `-DBOX3D_DISABLE_SIMD -ffp-contract=off` (already in the stale logs) to keep FP behavior stable — this is the box3d/Emscripten anticipated path. v0.1: document "single-threaded, same-build reproducible; no cross-platform guarantee yet." v1.0: a CI determinism test (same input → identical transform stream across runs, matching Rapier's deterministic-build discipline). Multithread/SharedArrayBuffer is explicitly **out** until post-1.0 (COOP/COEP headers are a real deployment gotcha — Jolt documents it up front).

### WASM packaging variants

Ship one npm package (`box3d-web`) with `exports` subpaths (jolt-physics' 7-way map is the reference; start with 2):

- `box3d-web` / `box3d-web/compat` — **compat**: WASM base64-inlined, works with every bundler, larger, sync-ish. The safe default we point beginners to.
- `box3d-web/separate` — separate `.wasm` asset via `new URL('box3d.wasm', import.meta.url)` (the loader already does this), smaller, async `init()`, some bundlers need config.
- **Loud, explicit `await init()`** in every quickstart — "why is physics undefined" is the #1 support question across all these projects.
- Multithread variant: post-1.0, opt-in, behind COOP/COEP docs.
- Every release changelog line pins the native commit: *"v0.x.y wraps box3d@<commit>, built with Emscripten 6.0.2."*

---

## 4. Phase plan

Delegation tags per the model rubric: **codex** (gpt-5.5) = bulk/mechanical, effectively free; **sonnet/opus** = taste-sensitive (API design, docs, demo polish); **fable/opus** = design review + public-API sign-off; **owner** = product lead + QA gate, runs browsers/deploys/git (codex sandbox can't spawn browsers or write inside `.git`). Every implementer prompt carries: *"You are the implementer. NEVER call the Agent tool. Work synchronously with Read/Write/Edit/Bash."*

### Phase 0 — Legal & provenance hygiene

**Goal:** reproducible, attributable native artifact before any packaging.
**Deliverables:**
- Record exact box3d source: the vendored `box3d-src` came from a `main`-branch zip (SHA256 `54664F…330F`) with no commit recorded. Re-download from `erincatto/box3d` at a specific tag/commit, record it in `native/BOX3D_VERSION` (URL + commit + tag). README references `v0.1.0`.
- `native/scripts/build-wasm.sh` — reproducible Emscripten build: pin Emscripten **6.0.2**, flags `-O3 -DNDEBUG -DBOX3D_DISABLE_SIMD -ffp-contract=off -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createBox3DModule -s ENVIRONMENT=web,worker -s ALLOW_MEMORY_GROWTH=1`. Do NOT vendor the full `emsdk/` into npm — install it in CI. Exclude `box3d/samples/` from the include path (drops sokol/jsmn/tiny_obj).
- **Fix the export drift:** the current `EXPORTED_FUNCTIONS` list (19 in logs) must match the 26 the WASM actually exports, plus `_malloc`/`_free`. Codify the full list in the build script; over-export the new v0.1 additions (destroyJoint) in the same recompile.
- `THIRD_PARTY_NOTICES.md` + `LICENSE` (MIT, ours) + attribution of box3d MIT.
- Output verification step: assert export count and a WASM SHA against a checked-in expected value.
**Effort:** M. **Delegation:** codex writes the build script + notices; **owner runs the Emscripten build** (`emcc.exe`, `EMCC_TEMP_DIR=D:\tmp`, emsdk at `vendor/box3d-experiment/emsdk`) — agents can't reliably drive the native toolchain. fable/opus reviews the license aggregation.
**Exit:** `build-wasm.sh` reproduces a byte-comparable WASM from a pinned box3d commit; notices complete; export count verified.

### Phase 1 — Core extraction (`box3d-web`)

**Goal:** framework-agnostic typed API, no singleton, with unit tests.
**Deliverables:**
- `packages/core/src/wasm-loader.ts` — rewrite the hand-written `box3d.js` (4,592 bytes) as typed TS. Fix the `__wasm_call_ctors` vs `_initialize` mismatch (WASM exports `_initialize`). Keep the fresh-view HEAP getters (correct for `ALLOW_MEMORY_GROWTH`). Supply **every** env import (`emscripten_notify_memory_growth` etc.) or `WebAssembly.instantiate` throws a LinkError. Add browser + worker + Node loading paths.
- `packages/core/src/raw-module.ts` — maintained low-level `.d.ts` (fix: shape-add functions return `int`, not `void`).
- `packages/core/src/index.ts` — rewrite `box3d-bridge.ts` into `createBox3D()` returning a world factory. **No forced module singleton.** Branded typed handles: `WorldHandle`, `BodyHandle`, `ShapeHandle`, `JointHandle`. Add `destroyJoint`. Scratch-buffer disposal lifecycle (currently leaks forever).
- Extract the reusable runtime helpers into their own modules: `fixed-step.ts` (clamp delta 0.1, accumulate 1/60, 4 substeps, cap catch-up at 3 steps/frame — from yard/playground/cup), `transform-buffer.ts` (Int32Array ids + Float32Array 7-float layout, dirty rebuild, direct/copy read), `sleep-manager.ts` (force-sleep after spawn + periodic <1cm/2s sweep — the island-sleep rule), `radial-impulse.ts` (the explode workaround for the native no-op on sleeping bodies), `body-pool.ts` (capped transient pool, destroy-oldest), `capabilities.ts` (generic feature probe).
- Unit tests (Vitest): loader init, every bridge fn, transform layout, contact/sensor events, **memory-growth** (allocate past initial 273 pages, verify HEAP views still valid), and a **determinism** test (same seed → identical transform stream across runs).
**Effort:** L. **Delegation:** opus/sonnet designs the public `createBox3D` API + typed handles (taste-critical, this is the surface everyone touches); codex does the mechanical helper extraction + test scaffolding; **fable/opus signs off the public API** before it's frozen.
**Exit:** `box3d-web` builds, all unit tests green including determinism + memory-growth, API reviewed and frozen for v0.1.

### Phase 2 — three.js adapter (`three-box3d`) + vanilla examples

**Goal:** the flagship package + source-visible vanilla demos.
**Deliverables:**
- `packages/three/src/index.ts` — `applyTransformToObject3D(obj, buf, offset)`, `writeTransformsToInstancedMesh(mesh, ids, buf)` (the InstancedMesh sync — with the **`vertexColors: false` warning baked into the API docs**, since that black-instance bug hit three separate meshes), hidden-instance matrix helper, offset utilities. `three` is a peer dep only.
- `examples/vanilla-three/` — minimal stack, ball drop, raycast pick, contact-event pulse. Each an independently deployable page (three-mesh-bvh's `examples-build.yml` pattern — examples are the product).
**Effort:** M. **Delegation:** sonnet/opus for the adapter API + example polish; codex for the example scaffolding + build config.
**Exit:** vanilla examples run on a real GPU (headed browser — headless swiftshader can't measure FPS), transforms sync correctly, no black instances.

### Phase 3 — R3F hooks (`r3f-box3d`) + dogfood this app

**Goal:** declarative layer + proof the library powers a real deployed app.
**Deliverables:**
- `packages/react/src/index.ts` — `useBox3D`, `useFixedStepWorld`, `useTransformBuffer`, `useInstancedTransforms`, optional `<Physics>` provider. `useFrame` + refs, never `setState` per frame (physics owns transforms; visuals stay in three.js). Don't force an ECS paradigm (cannon's mistake).
- **Port this app's pages to consume the library:** rewrite `WreckingYard.tsx`, `PhysicsPlayground.tsx`, `WorldCup.tsx` to import the extracted helpers from `three-box3d` / `r3f-box3d` instead of the inline `src/physics/*` copies. Keep app-specific gameplay (brick layouts, crane tuning, stadium colliders, kick choreography) in the app; only the reusable helpers move.
- Simplified `PhysicsPlayground` becomes `examples/r3f-playground/`; simplified wrecking-yard becomes `examples/r3f-wrecking-yard/`.
**Effort:** M/L. **Delegation:** opus/sonnet for hook API design + the app port (taste + correctness); codex for the mechanical example extraction. **Owner verifies by measurement** — the existing `window.__yardState`/`__cupState` bridges + Playwright E2E (`wrecking-yard.spec.ts`, `worldcup.spec.ts`) must still pass against the library-backed app, and FPS holds on a real GPU.
**Exit:** cars.swapp1990.org runs on the published (or `workspace:`) library with green E2E and unchanged FPS. This is the launch proof.

### Phase 4 — Docs, examples gallery, benchmarks, CI/release

**Goal:** the adoption infrastructure.
**Deliverables:**
- Docs site (VitePress or Astro — threlte/tresjs precedent), IA: Getting Started → Learning → Reference → Advanced. TypeDoc API ref auto-published in CI to GitHub Pages (@react-three/rapier pattern).
- **The gotchas doc** — promote `.claude/CLAUDE.md`'s "box3d physics + Three.js/R3F rules" into public docs: island-sleep, InstancedMesh `vertexColors:false`, `<Environment>`/`<Text>` Suspense isolation, native-explode no-op + radial-impulse workaround, fixed-step death-spiral, the loader's env-import requirement, "verify FPS on a real GPU." This is unique published content no competitor has.
- Examples gallery: per-capability, source-visible, independently linkable pages, auto-deployed (three-mesh-bvh's `examples-build.yml`). StackBlitz/CodeSandbox embeds in README.
- `npm run benchmark` with checked-in baselines (step time vs. body count; the sleep-sweep's effect on idle step time).
- CI split by concern: `test.yml` (lint + `tsc --noEmit` + Vitest matrix), `examples-build.yml` (build every example), `codeql.yml`, `release.yml` (Changesets-driven coordinated multi-package publish). Native build in its own workflow with the Emscripten pin.
**Effort:** L. **Delegation:** codex for all CI YAML + TypeDoc/Changesets setup + benchmark harness (mechanical); opus/sonnet for docs prose + gallery curation + the gotchas rewrite (taste); fable/opus reviews docs IA.
**Exit:** docs site live, gallery deployed, CI green on all workflows, `changeset version` → publish dry-run works.

### Phase 5 — Launch

**Goal:** distribution.
**Deliverables:**
- three.js **Discourse** forum post first (where the technical audience + gkjohnson/pmndrs live) — lead with the gotchas + hardening, not "another WASM build."
- X thread (@moltybuilds90) with a demo GIF of /wrecking-yard demolition linking a live example page.
- Show HN once examples gallery + docs are solid.
- **pmndrs outreach** — the distribution unlock. Rapier's R3F layer was adopted → 1,409★. Approach with the working `r3f-box3d` + dogfood proof, propose `@react-three/box3d`.
- three.js official addon aspiration (Jolt's path: `three/addons/physics/`) — a distribution channel independent of npm/stars.
**Effort:** M. **Delegation:** opus/sonnet drafts posts/thread (copy = taste); **owner posts** and runs pmndrs outreach (relationships). Seed the X post via the MOLTY_TWITTER seed workflow.
**Exit:** published to npm, launch posts live, at least one pmndrs/three.js-maintainer conversation opened.

### Phase 6 — Sustain

**Goal:** keep it alive as a solo + agent-maintained project.
**Deliverables:**
- Issue triage cadence: weekly sweep; label `upstream-churn` for anything traced to a box3d native change.
- **Upstream-tracking policy** (box3d is pre-1.0, PRs disabled): watch `erincatto/box3d` for breaking changes; isolate all native surface in `bridge.c` so a native bump is one recompile + one changeset. Never depend on upstream accepting a patch.
- Versioning policy: SemVer for our API; every release pins the wrapped box3d commit in the changelog. A native bump that changes behavior = at least a minor.
- Sponsorship: GitHub Sponsors framed as funding *maintainer time* (three-mesh-bvh model), not deliverables. Cite production users (this app) in the README instead of marketing.
- Agent-driven maintenance: a scheduled agent watches upstream box3d releases and drafts the bridge-update + changeset for owner review.
**Effort:** ongoing. **Delegation:** codex drafts upstream-bump PRs; owner reviews/merges; opus for any API-affecting decisions.
**Exit:** (steady state) new box3d release → PR drafted within a week; issues triaged weekly.

---

## 5. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| box3d pre-1.0 API churn; **PRs disabled upstream** | High | High | All native surface behind `bridge.c`; pin commit per release; a native bump = one recompile + changeset; agent watches upstream |
| box3d-wasm ships an R3F layer first | Medium | High | Move fast to Phase 3 dogfood proof; launch on integration quality + gotchas, not feature parity; offer interop (wrap their module) rather than compete on compile |
| Box.com `.box3d` SEO collision | Low | Low | Disambiguating tagline everywhere; flagship name `three-box3d` sidesteps the bare term |
| WASM bundler support matrix (Vite/webpack/Rollup/esbuild) | Medium | Medium | Ship compat (base64) as safe default + separate-wasm variant; loud `await init()`; document per-bundler config; the loader already handles the `?url` / `new URL` split |
| Solo-maintainer burnout | Medium | High | Heavy CI automation; agent-drafted upstream bumps; Sponsors funds time; scope discipline (v0.1 is small) |
| WASM-recompile constraint (bridge fns only addable at compile time; `emcc.exe` not `.bat`; needs `EMCC_TEMP_DIR`) | Certain | Medium | Over-export deliberately every recompile (repo rule); owner owns the native build (agents can't drive it reliably); keep emsdk pin documented |
| Determinism claims outrun reality | Medium | Medium | Ship conservative claim in v0.1 (single-thread, same-build); only claim cross-platform after the CI determinism test lands (v1.0) |
| Over-investing in commoditized core vs. moat layer | Medium | Medium | Budget rule: adapter + examples + docs get ≥ the effort the core gets (three-mesh-bvh: examples are the product) |

---

## 6. Success metrics

Realistic for a solo + agent-maintained niche physics binding launching into an already-contested week-old space.

| Metric | 3 months | 6 months | 12 months |
|---|---|---|---|
| npm weekly downloads (`three-box3d`) | 100 | 500 | 2,000 |
| GitHub stars (repo) | 150 | 500 | 1,200 |
| Live examples deployed | 6 | 12 | 20 |
| External contributors (merged PR) | 1 | 3 | 8 |
| Docs/examples unique visitors/mo | 500 | 2,000 | 6,000 |
| pmndrs interest | conversation opened | endorsement or `@react-three/box3d` scope discussion | adopted or officially cross-linked |
| three.js addon | — | proposal filed | listed |
| Production users cited in README | 1 (this app) | 3 | 6 |

Benchmarks (for reference against competitors): Rapier's r3f layer is at 1,409★, box3d-wasm at 12★ and climbing. Beating box3d-wasm's star count within 6 months on the strength of the R3F layer + docs is the concrete near-term target.

---

## 7. Immediate next actions

1. **[owner]** Create the GitHub monorepo (`three-box3d` org or personal), reserve npm names `three-box3d`, `box3d-web`, `r3f-box3d` (publish empty `0.0.0` placeholders to hold them — box3d-wasm proves the space moves in days).
2. **[owner]** Re-download box3d at a specific tag/commit from `erincatto/box3d`, record in `native/BOX3D_VERSION`; run one clean Emscripten build with the fixed 26-export list to confirm the toolchain reproduces the current WASM.
3. **[codex]** Write `native/scripts/build-wasm.sh` with the pinned flags + full `EXPORTED_FUNCTIONS` + output verification, and `THIRD_PARTY_NOTICES.md` aggregating box3d MIT (exclude `samples/`). Prompt includes the implementer/no-Agent guardrail.
4. **[opus]** Design the `createBox3D()` public API + branded typed handles + `destroyJoint` addition (draft the `bridge.c` diff for owner to compile). This is the frozen surface — get it right before extraction.
5. **[fable/opus]** Design-review this whole plan's Phase 0–1 sequencing and the public API draft; sign off or flag before extraction starts.

---

## Sources

- box3d upstream (MIT, alpha, PRs disabled, 4,741★): https://github.com/erincatto/box3d
- box3d-wasm (monteslu, npm v0.2.0, repo 2026-07-02): https://www.npmjs.com/package/box3d-wasm — https://github.com/monteslu/box3d-wasm
- ikekou box3d demos: https://ikekou-box3d-demos.pages.dev/
- Rapier + R3F layer (shape to copy): https://github.com/dimforge/rapier.js — https://github.com/pmndrs/react-three-rapier
- three-mesh-bvh (solo-maintainer + examples-as-product gold standard): https://github.com/gkjohnson/three-mesh-bvh
- JoltPhysics.js (C-engine Emscripten port precedent, 7-flavor WASM matrix, three.js addon): https://github.com/jrouwe/JoltPhysics.js
- pmndrs (distribution flywheel; cannon→rapier cautionary tale): https://github.com/pmndrs
- Emscripten (build toolchain, pinned 6.0.2): https://github.com/emscripten-core/emsdk
- Internal research inputs (session artifacts, 2026-07-08; findings folded into this doc): prior-art/licensing web sweep, three.js-OSS playbook sweep, codex extraction inventory of `src/physics/*` + `vendor/box3d-experiment/`
- Repo hard-won rules (become the gotchas doc): `.claude/CLAUDE.md` § "box3d physics + Three.js/R3F rules"
