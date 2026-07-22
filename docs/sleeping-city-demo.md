# Sleeping City — box3d flagship demo (goal + spec)

## Goal

Build the demo that gets developers to notice three-box3d. box3d is a prototype
physics library with ~0 stars; developers don't star libraries from promo posts —
they star them after *experiencing* something impressive. Our strongest, unclaimed
hook is **island-aware sleep at scale**: box3d's own benchmark is 1,000 active
bodies ≈ 1.17 ms/step vs. the same 1,000 asleep ≈ 0.005 ms (~230×). No competing
physics demo (Rapier, cannon-es, Jolt) makes sleep visible or the point of the show.

"Sleeping City": a city block / stadium of **thousands of individually-simulated
rubble pieces sitting at ~0 ms/frame because they're asleep** — until you hit it,
and you watch the wake-up ripple through the structure as a heatmap, then watch it
resettle to zero cost. The demo is the shareable unit; it routes viewers to this
repo. Distribution target: the three.js forum Showcase + the official three.js /
poimandres Discords, framed honestly as "typed three.js port of Box2D-creator Erin
Catto's 3D engine — 6,000 bodies that cost nothing until you touch them."

Success = a demo that clears the 60fps bar (verified on a real GPU), makes a
technical viewer go "how is this in a browser," and drives measurable demo visits →
GitHub stars (the agency dashboard already tracks both).

## Two-repo layout (read before starting)

This demo spans two sibling repos under `D:\MyProjects\Claude\`:

- **three-box3d (this repo)** — the physics engine. Core deliverable: a cheap,
  bulk per-body sleep-state accessor the heatmap needs. Pure logic + unit tests,
  **no GPU required** — this is the right place for codex to START.
- **3d-car-assembler** — the demo app (this is what deploys to cars.swapp1990.org;
  wrecking-yard / ball-lab live here). Demo deliverable: the scene, heatmap, level
  geometry, HUD. It consumes box3d via the `box3d-web` / `three-box3d` workspace
  packages. Full app-side spec: `3d-car-assembler/plans/sleeping-city-demo.md`.

## Core deliverable (three-box3d)

The heatmap recolors every body each frame by awake/asleep state at 4,000–6,000
bodies. A per-body function call at that count is too much overhead — provide a
**zero-alloc bulk read**:

- Check whether the SleepManager already exposes per-body awake state on the body
  handle. If a single-body read exists (e.g. `body.isAwake()`), keep it; ADD a bulk
  form, e.g. `world.sleepStates(outUint8Array)` or `world.forEachBody(cb)` that fills
  a caller-provided typed array with 0/1 per body index, no per-call allocation.
- Read-only surface — must NOT change any simulation behavior. Determinism and step
  results stay bit-identical.
- Unit tests (vitest, CPU-only, seconds to run): settled bodies report asleep;
  a struck/awakened body reports awake; the bulk array matches per-body reads;
  no allocation in the hot path (assert stable array identity / reuse).
- Version-bump the package and re-sync into the demo app.

## Demo deliverable (3d-car-assembler) — summary

Reuse `WreckingYard.tsx` / `src/physics/yardPhysics.ts` (already runs ~1,400 bricks
with a cannonball, chain wrecking ball, drag tool, and a bodies/awake/step-ms/FPS
HUD). New work: (1) parameterized scale to 4,000→6,000; (2) the sleep heatmap —
per-instance InstancedMesh color driven by the new bulk accessor, so the sleep
boundary propagating through the structure is the visual; (3) an "idle cost vs active
cost" HUD callout that makes the ~0 ms-at-rest legible; (4) stadium/city-block level
geometry that holds thousands of settled bodies and collapses dramatically. Keep
interactions to the proven cannonball + wrecking ball + drag. Out of scope: replay/
determinism demo (that's the *next* one), networking, soft bodies, "production ready"
claims. Full detail in the app repo's plan.

## Performance target + what the GPU dry-run taught us

Certify **60fps sustained on a real GPU** at the shipped body count, then set the
public number to the verified figure (never before). Verification runs off the
operator's machine via the proven kit `impressions-agency/infra/gpu-verify/` (AWS
g4dn.xlarge / Tesla T4; one command up, one down; `verify.mjs` proves hardware GPU
via NVIDIA vendor-id + renderer string and refuses to report FPS on software
fallback).

Key learning from the dry run (2026-07-22): the existing wrecking-yard, with ~1,400
**active** bodies, measured ~39fps on that T4 box — and that is almost certainly
**CPU-bound on the single-threaded WASM physics step** (the g4dn.xlarge has only 4
modest vCPUs; box3d's headline benchmark was a fast i9 desktop), not a GPU-render
limit. Two implications for this demo:
1. Sleeping City's premise plays to this: **at rest, asleep bodies cost ~0 CPU**, so
   the scene is render-bound and should clear 60fps far more easily than always-active
   wrecking-yard. The sleep story is exactly what makes it perform.
2. The *collapse* phase (many bodies suddenly awake) is CPU-bound; the 4-vCPU box is a
   conservative floor. If certifying the active phase specifically, use a bigger-vCPU
   instance (e.g. g4dn.2xlarge+) or a g5 (A10G) — decide when we get there. Report
   both at-rest and post-collapse-recovery FPS separately.

## Acceptance criteria (gate before any showcase post)

1. Loads to a fully-asleep scene reading ~0 ms step / 0 awake at the target count.
2. Striking it wakes a spatially-coherent region (heatmap shows a propagating
   boundary), then resettles to ~0 ms.
3. Sustains 60fps at rest and recovers to 60fps after a large collapse, measured on a
   real GPU via the gpu-verify kit (renderer must name the NVIDIA GPU, not Mesa/
   SwiftShader). Report at-rest and recovery FPS.
4. Public body-count number == the verified figure.
5. Mobile degrades gracefully (lower default count by UA); never hard-crashes.

## Build phases

1. **Core (this repo):** bulk sleep-state accessor + unit tests + version bump. ← codex starts here
2. **Scale + level (app repo):** parameterize count, build the level, 4,000 bodies settling & collapsing on the existing pipeline.
3. **Heatmap + HUD callout (app repo):** per-instance sleep coloring toggle; idle-vs-active cost callout.
4. **GPU verification:** run the gpu-verify kit; set the public number; tune mobile default.
5. **Deploy + capture:** ship to cars.swapp1990.org/sleeping-city; capture the showcase clip.

## For codex

Start with Phase 1 in THIS repo — it's pure logic, unit-tested, needs no GPU or
browser, so it won't tax the operator's machine. Prereq: the working tree must be
clean with `packages/core` present (see the repo owner if core source is missing).
Suggested kickoff: `codex exec -s workspace-write` pointed at three-box3d with the
task "implement the bulk sleep-state accessor per docs/sleeping-city-demo.md Phase 1,
with vitest coverage; do not change simulation behavior." Phases 2–3 switch to the
3d-car-assembler repo; Phase 4 uses the impressions-agency gpu-verify kit.
