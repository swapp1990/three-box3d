# Box3DUnreal destruction-physics research and comparison

**Research date:** 2026-08-02  
**Audience:** `three-box3d` maintainers  
**Upstream reviewed:** [`alattanzio/Box3DUnreal`](https://github.com/alattanzio/Box3DUnreal) at commit [`5f4e27f`](https://github.com/alattanzio/Box3DUnreal/commit/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0)  
**Our open-source baseline:** `swapp1990/three-box3d` at `origin/main` commit `0cdeb11`, local `HEAD` `912caf0`, plus the current uncommitted core work  
**Our application reference:** `swapp1990/3d-car-assembler` at commit [`0524744`](https://github.com/swapp1990/3d-car-assembler/commit/0524744f552e3b26f65f7fb495f79c07b8d300a8)

## Executive conclusion

Box3DUnreal does **not** contain a destruction or fracture system.

It is a young but substantial Unreal integration for Box3D. It creates one Box3D world per Unreal world, converts Unreal collision into Box3D shapes, advances the simulation on a fixed timestep, moves Unreal actors from Box3D results, provides scene queries and debug tools, and contains early authority, snapshot, and rollback foundations. It does not calculate damage, fracture a mesh, maintain breakable bonds, spawn fragments, or turn an impact into structural failure.

This distinction matters because the underlying Box3D engine is a rigid-body simulator, not a destruction authoring system. Box3D can move already separate pieces and apply an explosion impulse to them. It does not decide how a solid object becomes those pieces. Even Box3D's sample named “Destruction” destroys and respawns whole box bodies; it is a body-churn benchmark, not geometric fracture.

Our work is ahead in the part that is actually destruction:

- The `/demolition` application has deterministic 3D cell generation, an energy-based material damage model, crack propagation, one generation of sub-fracture, support-graph collapse, fragment budgets, and real Box3D rigid-body motion after a break.
- The public `three-box3d` library has a much broader web-facing runtime surface: impulses and forces, joints, contact events, transform buffers, sleeping helpers, pooled bodies, Three.js synchronization, and React Three Fiber hooks.

However, the reusable destruction work still lives in the application, not in this open-source library. It also uses axis-aligned box collision proxies for visually irregular pieces. The main opportunity is therefore **extraction and collision fidelity**, not replacing our physics foundation with Box3DUnreal.

The best use of Box3DUnreal is as a reference for four concerns:

1. importing and baking collision data;
2. keeping simulation ownership explicit;
3. providing fixed-step interpolation and debug tooling;
4. designing deterministic and network-aware lifecycle rules.

It should not be adopted as a dependency, and it does not give us a ready-made destruction implementation to port.

## Scope and terminology

I treated “our Box3D open-source repo” as this `three-box3d` repository. I treated “what we have done so far” as both:

- the published and local work in `three-box3d`; and
- the working destruction demonstrations in `3d-car-assembler`, because that is where our fracture and damage logic currently exists.

In this report, “destruction” means the complete chain below:

1. **Fracture geometry:** decide what the pieces are.
2. **Damage:** decide whether an impact is strong enough to break something.
3. **Connectivity:** decide which pieces are still supported or bonded.
4. **Activation:** replace or release intact material as rigid bodies.
5. **Physics:** simulate the released pieces.
6. **Rendering and cleanup:** show, sleep, pool, fade, or remove the pieces.

A pile of independent boxes falling over demonstrates rigid-body physics. It is not, by itself, a fracture system.

## What Box3DUnreal actually implements

### 1. Unreal lifecycle and simulation ownership

`UBox3DSubsystem` owns one Box3D world for each Unreal `UWorld`. Only the authority simulates; a pure client does not create a Box3D world and instead follows replicated actor movement. The subsystem advances a fixed-step accumulator, pushes kinematic targets before each step, captures dynamic transforms afterward, and interpolates visual actor poses between steps.

Evidence:

- [Subsystem contract and fixed-step configuration](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Public/Box3DSubsystem.h#L17-L23)
- [Authority-only world creation](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Private/Box3DSubsystem.cpp#L41-L70)
- [Fixed stepping and interpolation](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Private/Box3DSubsystem.cpp#L687-L735)

This is sound engine-integration work. It solves who owns movement, which clock advances physics, and how a fixed simulation looks smooth at variable render rates.

### 2. Body and collision import

An Unreal actor can receive a `UBox3DBodyComponent`. It supports static, kinematic, and dynamic bodies. Collision can be a box, sphere, capsule, or convex hull. Convex mode reads Unreal's cooked simple collision, turns each simple convex element into a Box3D hull, and attaches multiple hulls to one body when needed.

Static geometry has a more complete path. The plugin can convert simple collision or cooked triangle meshes, register tagged level geometry, and bake collision into `UBox3DCollisionData` assets so packaged builds do not need to cook it at runtime. The baked asset stores a source fingerprint and Box3D version so stale collision can be detected.

Evidence:

- [Supported body and shape types](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Public/Box3DBodyComponent.h#L12-L37)
- [Primitive and convex shape creation](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Private/Box3DBodyComponent.cpp#L265-L380)
- [Baked static-collision data model](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Public/Box3DCollisionData.h#L8-L18)
- [Runtime loading of baked static bodies](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Private/Box3DSubsystem.cpp#L478-L528)

This is the upstream project's most useful work for us. Our Voronoi fragments are convex, but our public web bridge cannot currently accept arbitrary hull vertices. Box3DUnreal demonstrates the native shape path we are missing.

### 3. Queries, debugging, determinism, and rollback foundations

The subsystem exposes closest raycasts, multi-hit raycasts, overlap queries, and sweeps. The repository also includes console-driven query, determinism, snapshot, and rollback checks.

Its rollback code is not a complete networked-physics product. The snapshot ring assumes a stable body set and body order. A snapshot stores body pose, velocities, and awake state, but not destruction topology, damage state, contact caches, or newly created fragments. The source explicitly leaves spawn and despawn during the rollback window out of scope.

That limitation is especially important for destruction: a fracture changes the number and identity of bodies. Replaying only transforms cannot reconstruct a break.

Evidence:

- [Snapshot-ring assumptions](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Public/Box3DPrediction.h#L20-L27)
- [Snapshot contents](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Public/Box3DSnapshot.h#L8-L17)
- [Reconcile and replay implementation](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Private/Box3DPrediction.cpp#L93-L163)

### 4. What is absent

There is no destruction pipeline in the Unreal integration:

- no Voronoi, planar, radial, brick, or authored fracture generation;
- no damage or material-strength model;
- no impact-energy calculation;
- no contact or hit-event consumption;
- no breakable bond or support graph;
- no fragment activation or debris policy;
- no explosion call in runtime plugin code;
- no runtime shape split or partial body break;
- no Geometry Collection integration;
- no Chaos-to-Box3D interaction.

Whole body teardown is the only destructive lifecycle operation: the component calls `b3DestroyBody` and frees any owned static mesh data. The only linear impulse found in plugin source is inside the rollback test.

The README is accurate when it calls the project early development and says it is focused on core integration. It also lists no Chaos interaction and limited editor tooling. Some README limitations are stale: the source now has authority gating, actor movement replication, Blueprint-callable queries, and rollback utilities, while the README still says “No multiplayer/network replication” and “No Blueprint API.” This should be read as evidence of a fast-moving prototype, not as a stable destruction product.

- [Upstream early-development statement](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/README.md#L23-L28)
- [Current limitations in the README](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/README.md#L169-L190)
- [Whole-body destruction path](https://github.com/alattanzio/Box3DUnreal/blob/5f4e27f192f21fc9a5f5b9fe5a207af8b42239a0/Box3DUnreal/Source/Box3DUnreal/Private/Box3DBodyComponent.cpp#L429-L448)

## What Box3D itself provides—and what it does not

Box3D provides the rigid-body ingredients a destruction system needs: convex hulls, multiple shapes per body, contact and hit events, contact impulses, forces, joints, queries, sleeping, continuous collision detection, and an explosion impulse.

It does not provide automatic fracture. Its documentation says an application can destroy a shape to model a breakable object. It also warns that long chains of weld joints can flex because the solver is approximate. That warning argues against representing every fracture bond as a rigid weld joint.

For our design, Box3D should answer “how do released pieces move?” The application or a new library layer should answer “when and where does the object break?”

Evidence:

- [Box3D feature summary](https://github.com/erincatto/box3d/blob/e961bfb7bf9123188eb0addc71194c9d7af60e41/README.md#features)
- [Manual shape removal as a breakable-object tool](https://github.com/erincatto/box3d/blob/e961bfb7bf9123188eb0addc71194c9d7af60e41/docs/simulation.md#L685-L701)
- [Warning about weld joints in breakable structures](https://github.com/erincatto/box3d/blob/e961bfb7bf9123188eb0addc71194c9d7af60e41/docs/simulation.md#L1518-L1537)

Box3DUnreal pins Box3D commit `e961bfb7`, while `three-box3d` currently pins the earlier `v0.1.0` commit `8441b4a`. Box3DUnreal also enables double precision; our WASM build uses single precision. Those are deliberate platform choices and should not be copied without measuring WASM size, speed, and determinism.

## What we have in `three-box3d`

### Published on `origin/main`

The published library has more of the runtime surface needed by a web destruction system than Box3DUnreal exposes through Unreal:

- dynamic, static, and kinematic bodies;
- box, sphere, capsule, and sensor shapes;
- impulses, forces, torque, velocity, damping, mass, inertia, and gravity control;
- spherical, revolute, distance, and filter joints, including motors;
- contact-begin and sensor events;
- closest raycast;
- fixed-step, transform-buffer, sleeping, radial-impulse, and body-pool helpers;
- direct Three.js object and `InstancedMesh` synchronization;
- React Three Fiber world, stepping, buffer, and instance hooks.

The relevant public surface is visible in [`packages/core/src/index.ts`](../packages/core/src/index.ts), and the extracted helpers are exported from [`packages/core/src/helpers/index.ts`](../packages/core/src/helpers/index.ts).

This is a good low-level foundation, but it is not a destruction API. There is no fragment asset, damage state, cell graph, body-to-piece lifecycle, or fracture controller in the repository.

### Present locally but not yet published

The current working tree adds useful inputs for future destruction:

- contact-end events;
- hard-contact hit events with point, normal, and approach speed;
- per-body normal contact-load telemetry;
- bulk sleep-state reads;
- motor-torque telemetry;
- additional body observables and helpers;
- scalar, compatibility, and SIMD WASM variants.

Relevant local code:

- [Contact begin/end/hit drains](../native/bridge.c#L839)
- [Per-body contact-load telemetry](../native/bridge.c#L939)
- [Typed event queues](../packages/core/src/world.ts#L196)
- [Contact event types](../packages/core/src/types.ts#L112)
- [Bulk sleep-state reads](../packages/core/src/world.ts#L1146)

These additions reduce the work needed to detect damaging impacts, but they still do not implement damage or fracture. The current body-contact-load call allocates a native contact buffer on every call. Polling it once per frame for thousands of fragments would be too expensive; a destruction system should prefer world-level hit events or a bulk, allocation-free query.

### Important current gaps

1. **No arbitrary convex-hull shape API.** The bridge internally creates a hull for a box, but callers cannot provide hull vertices. This is the largest collision-fidelity gap for our convex Voronoi pieces.
2. **No mesh or height-field creation API.** Box3D supports them, but the web bridge does not expose them. Dynamic fracture pieces should still be convex; mesh support is mainly useful for static surroundings.
3. **No shape user data or stable application identity.** Body handles alone become awkward when one body has multiple shapes or handles are reused.
4. **No individual shape destruction.** Body teardown is all-or-nothing. This is acceptable for one-body-per-fragment designs but not compound breakable objects.
5. **No joint-force or joint-break telemetry.** Motor torque exists locally, but general joint reaction loads and break thresholds are absent.
6. **No body/shape destruction event.** The renderer and game layer must already know every removal.
7. **No broadphase overlap query for a blast.** `radialImpulse` scans the caller's body list and transform buffer.
8. **No destruction-aware Three/R3F lifecycle.** The adapters copy transforms; callers own fragment slots, geometry, material groups, hiding, and cleanup.

## What our application already does

### `/demolition`: real application-level destruction with approximations

The demolition page is a real Box3D rigid-body destruction prototype. Its fracture and damage decisions are implemented in TypeScript above Box3D.

Before the first hit, the wall is one static Box3D box. Material-specific fracture cells are generated deterministically—normally at load time, and at impact time for glass. On the first damaging hit, the system destroys the monolith body, selects failed cells, optionally subdivides some of them, creates dynamic bodies for released chunks, creates static bodies for the remaining wall, applies energy-derived launch velocities, and runs a support-graph collapse. Later hits can release more of the static remnant.

Key evidence:

- [Deterministic 3D cell generation and one-generation subdivision](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/fracture/voronoiFracture.ts#L1-L7)
- [Damage-event and material model](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/physics/damageModel.ts#L41-L77)
- [Intact monolith creation](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/physics/demolitionPhysics.ts#L731-L759)
- [First-impact monolith-to-fragment transition](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/physics/demolitionPhysics.ts#L1497-L1671)
- [Subsequent carving](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/physics/demolitionPhysics.ts#L1685-L1823)
- [Upward support-graph collapse](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/physics/demolitionPhysics.ts#L1900-L1967)
- [Contact-driven projectile damage](https://github.com/swapp1990/3d-car-assembler/blob/0524744f552e3b26f65f7fb495f79c07b8d300a8/src/physics/demolitionPhysics.ts#L2193-L2295)

This is meaningful destruction work, not a simple scripted animation. The physical caveats are equally important:

- The rendered cell is an irregular convex polyhedron, but its Box3D collider is a shrunken axis-aligned box around the cell. Collision and visuals therefore do not match exactly.
- The intact wall does not secretly contain connected physical fragments. The first hit swaps one monolith body for many static and dynamic proxy bodies.
- Connectivity is a logical adjacency/support graph, not solver constraints between pieces.
- Only one generation of sub-fracture is supported.
- Glass partitions on the first impact and does not repartition on later hits.
- Pieces below the size floor and pieces rejected by the dynamic-body cap become manually integrated visual shards rather than Box3D bodies.
- Collapse staggering currently uses `Math.random`, so that timing is not fully deterministic even though fracture seeding is deterministic.
- Synthetic `probeImpact` and `probeDetonate` paths use the real resolver but bypass waiting for a physical contact; they are test/showcase controls, not evidence that every path begins with a solver event.

The cleanest description is: **real rigid-body destruction driven by a custom, deterministic cell-and-damage layer, with simplified collision proxies and bounded visual fallback debris.**

### Wrecking Yard and Sleeping City: physical collapse, not fracture

Wrecking Yard and Sleeping City are excellent scale and sleep demonstrations, but they should not be presented as fracture systems.

They create independent Box3D brick bodies from the start. A dynamic wrecking ball, cannonball, or radial impulse wakes and moves those bricks. The Sleeping City cascade uses a scripted starting pose and launch velocity for the ball and chain; the resulting contact wave and brick motion are simulated. Old settled bricks can be retired to static bodies and reactivated by later contacts.

No brick splits into smaller pieces. “Destruction” is the collapse of a structure assembled from already separate rigid bodies.

## Side-by-side comparison

| Area | Box3DUnreal | `three-box3d` library | Our `/demolition` application |
| --- | --- | --- | --- |
| Primary job | Integrate Box3D with Unreal actors and assets | Typed Box3D WASM runtime for web/Three/R3F | Demonstrate destructible materials and collapse |
| Fracture generation | None | None | Deterministic 3D Voronoi, brick, anisotropic, and radial partitions |
| Intact object | One normal actor/body | Caller-defined | One static monolith box |
| Damage model | None | None | Energy, material strength, fracture energy, brittleness, anisotropy, accumulated rim damage |
| Impact input | Plugin does not consume Box3D contact/hit events | Contact begin published; richer hit/end/load telemetry local | Projectile contact approach speed converted into a damage event |
| Connectivity | None | Joints are available, but no break graph | Logical cell adjacency plus upward support graph |
| Break operation | Whole body teardown only | Whole body teardown only | Destroy monolith or static cell body; create/demote fragment bodies |
| Dynamic fragment collider | Convex hulls from Unreal simple collision are supported | Box/sphere/capsule only | Shrunken axis-aligned box proxy |
| Static environment | Strong UE collision extraction, tri-mesh, tagging, streaming, and bake path | Primitive shapes only | Static ground and wall proxy bodies |
| Explosion | Not wired into plugin runtime | Native wrapper plus a sleeping-safe `radialImpulse` helper | Damage event plus explicit fragment impulses |
| Rendering | One Unreal actor per body | Object3D and InstancedMesh transform adapters | True cell geometry, separate exterior/interior materials, merged static remnant, instanced effects |
| High body count | No fragment-specific path demonstrated | Transform buffers, instancing, sleep management, worker-friendly WASM foundation | Caps, sleeping, fading, visual shard fallback; Sleeping City proves 2,000–4,000 brick scale |
| Fixed-step behavior | Fixed accumulator and actor interpolation | `FixedStepper` with catch-up guard; local adaptive budget | Uses `FixedStepper`, fixed 60 Hz, four contact substeps |
| Networking | Authority and actor-replication foundation; prediction utilities not integrated into a destruction topology | None | None |
| Determinism | Double precision and raw-world determinism/rollback console checks | Determinism tests and fixed single-thread WASM | Seeded fracture; one nondeterministic collapse-delay path remains |
| Test style | Console self-checks; no repository CI workflow | CI, unit tests, real WASM, TypeScript type checks | Unit tests for fracture, closure, damage, profiles, yard, and worker protocol; E2E exists but was not verified in this research run |
| Product maturity | About three weeks old, early development, no releases/tags | Broader package foundation, still unreleased `0.0.0` | Feature-rich prototype inside an application, not a reusable package |

## What we should borrow from Box3DUnreal

### Borrow the collision asset pipeline

The strongest upstream idea is not in the solver loop. It is the separation between authored source geometry and runtime collision data.

For the web, the equivalent should be a serializable `DestructibleAsset` generated ahead of gameplay. It should contain:

- fragment vertices and faces;
- convex collision hull vertices;
- volume, centroid, and mass inputs;
- exterior versus interior face groups;
- adjacency and shared-face area;
- stable piece IDs;
- material/damage parameters;
- source-asset and Box3D-version fingerprints.

Load-time fracture can remain as a development fallback. Production scenes should be able to ship a baked asset so startup cost, geometry, and piece IDs are predictable.

### Borrow explicit authority and ownership rules

Box3DUnreal is careful about preventing Chaos and Box3D from both moving the same actor. Our equivalent rule should be equally clear:

- the destruction controller owns body creation and removal;
- the transform buffer is the source of physical pose;
- the Three/R3F adapter owns visual slots, not physics decisions;
- user callbacks observe lifecycle events but do not mutate internal arrays during a step;
- worker and main-thread modes use the same command/event contract.

### Borrow source fingerprints and stale-data warnings

Pre-fractured assets can silently become invalid when the source mesh, scale, material, or Box3D build changes. The Unreal bake's fingerprint/version check is simple and valuable. Our asset loader should warn or reject when its source fingerprint or schema version is stale.

### Borrow focused debug and headless checks

The upstream console tests are useful because they isolate determinism, snapshots, queries, and rollback. We should keep our stronger automated test style but add equally focused destruction probes:

- dump a piece/bond graph;
- fire a deterministic impact at a known point;
- report deposited energy and failed bonds;
- hash active piece IDs and body transforms;
- detect volume loss, orphan bodies, and stale render slots;
- replay a recorded destruction event stream.

## What we should not copy

### Do not model every bond with a weld joint

Box3D itself warns that chains of weld joints may flex. Thousands of per-face joints would also increase solver work and complicate sleeping. Our current logical adjacency graph is the better default. Use Box3D bodies only for released islands or pieces; keep intact connectivity in a cheaper graph.

### Do not use one scene object per fragment at scale

One Unreal actor per body is reasonable for the plugin's current examples. It is not the model to copy for thousands of browser fragments. Our typed transform buffers and instanced rendering are a better fit.

### Do not treat transform rollback as destruction rollback

A transform snapshot cannot reconstruct a topology change. Networked destruction needs an event or state model that includes:

- the fracture asset and deterministic seed;
- damage accumulated per stable piece or bond;
- the exact simulation frame of each break;
- created, activated, retired, and removed piece IDs;
- enough input history to replay from the same topology.

### Do not build the core library during normal application compilation

Box3DUnreal invokes CMake from UnrealBuildTool when its static library is missing. That is convenient for a source plugin but brings CMake/compiler discovery into the consumer build. Our committed and versioned WASM artifacts are more appropriate for npm distribution. Reproducible source builds should remain a maintainer workflow.

## Recommended open-source architecture

Keep `box3d-web` a focused rigid-body library. Add destruction as an optional layer instead of mixing application-specific fracture policy into `World`.

```text
source mesh or box
        |
        v
destruction asset builder  --->  serialized DestructibleAsset
                                      |
                                      v
damage + bond graph  --->  destruction controller  --->  box3d-web bodies
                                      |
                                      v
                          three-box3d fragment adapter
```

The minimum useful contracts are:

1. **`DestructibleAsset`** — immutable piece geometry, hulls, IDs, adjacency, and material data.
2. **`DamageEvent`** — point or volume, direction, energy/impulse, and damage mode.
3. **`DestructionController`** — owns intact state, accumulated damage, support/bond graph, fragment body lifecycle, caps, and deterministic event ordering.
4. **`DestructionEvent`** — piece activated, piece removed, bond failed, reset completed, and optional debris fallback.
5. **Three adapter** — maps stable piece IDs to merged or instanced visuals without teaching core physics about Three.js.

The controller should support two activation modes:

- **monolith swap**, matching the current demo and keeping intact scenes cheap;
- **pre-created sleeping fragments**, useful when instant activation matters more than idle memory.

Monolith swap should be the default because it scales better and matches our current proven design.

## Recommended implementation sequence

### Phase 1: finish the low-level inputs

1. Land or otherwise normalize the current contact hit/end/load and bulk sleep-state work.
2. Add `addHull(body, vertices, material)` with validation and a documented Box3D vertex limit.
3. Add stable shape identity or user data to contact/hit events.
4. Add an allocation-free blast candidate query or document caller-supplied body sets.
5. Decide whether individual `destroyShape` belongs in the first destruction slice. It is not required for monolith swap, so it should not block the initial release.

### Phase 2: extract the pure destruction logic

Move the reusable, Three-independent parts from `3d-car-assembler` into a new optional package or clearly isolated module:

- cell generation and subdivision;
- cell metrics and closure checks;
- material profiles;
- damage resolution and crack propagation;
- logical support/bond graph;
- deterministic ID and random-seed rules;
- fragment and sub-fragment budgets.

Do not move page controls, materials, camera behavior, particle effects, or showcase-specific tuning into the library.

### Phase 3: add the Box3D controller

Implement the monolith-to-fragment transition against the public `World` API:

- destroy the intact body;
- create exact convex hull colliders for released pieces;
- keep supported remnants logical or static;
- update the transform buffer in one controlled transaction;
- publish lifecycle events for renderer cleanup;
- reuse `BodyPool` ideas without making eviction silently lose structural state.

### Phase 4: add a Three.js adapter and one honest example

Ship one small wall example that clearly labels:

- fracture cells;
- physical hulls;
- static versus dynamic pieces;
- deposited energy and threshold;
- active body count and step time;
- any non-physical micro-debris.

The example should use the same library API a consumer would use. Avoid a second showcase-only runtime.

### Phase 5: scale and worker hardening

Only after the small example is correct:

- benchmark 100, 500, 1,000, and 4,000 pieces;
- add worker command/event parity;
- batch hit events and body creation;
- eliminate per-body per-frame native allocations;
- verify sleeping and static retirement;
- test repeated reset and fracture for memory leaks.

### Phase 6: network/replay support, if demanded

Treat this as a separate feature. Record structural events by fixed simulation frame and stable piece ID. Do not promise rollback from body transforms alone.

## Acceptance criteria for a reusable destruction slice

A first public version should not be called complete until it proves all of the following:

- the same asset, seed, fixed-step inputs, and impacts produce the same failed piece IDs;
- fragment volume is conserved within a documented tolerance;
- visual geometry and collision hulls agree closely enough that contacts look credible;
- a hit below threshold does not break the object;
- a stronger hit never causes less damage solely because of ordering;
- unsupported regions activate without requiring thousands of solver joints;
- reset leaves no bodies, shapes, transform slots, or GPU geometry orphaned;
- body and debris caps degrade visibly but do not corrupt the structural state;
- sleeping fragments stop consuming meaningful step time;
- contact, damage, break, activation, and rendering events are processed in a documented order;
- the public example and API use no private application-only shortcuts.

The current app tests already give us a useful base. In this research run, 54 targeted fracture, geometry-closure, damage, and material-profile tests passed. The current `three-box3d` working tree also passed its full build, type checks, and tests after following the repository's required build-first order. Destruction-specific end-to-end browser tests were not completed in this review, so no browser-visible pass is claimed here.

## Risks to address early

| Risk | Why it matters | Recommended control |
| --- | --- | --- |
| Visual cell versus box-proxy mismatch | Pieces can appear to float, collide early, or pass visually through gaps | Expose convex hull creation and use the actual cell hull |
| Per-body contact-load polling | Current local native helper allocates for every call | Use hit events or add one bulk, allocation-free load pass |
| Nondeterministic collapse delay | Break replay can choose different activation frames | Replace `Math.random` with the controller's seeded RNG |
| Handle reuse and missing shape identity | Late events can be attributed to the wrong application object | Stable piece IDs plus shape/body user data and generation checks |
| Topology-changing rollback | Transform snapshots omit created/destroyed pieces and damage | Replicate or record structural events by frame |
| Fragment geometry cost | Runtime subdivision can stall and allocate heavily | Bake assets, cap runtime work, and make fallback behavior explicit |
| Too many physical bonds | Joint count and solver softness can dominate | Logical bond graph; create bodies only after failure |
| Hidden non-physical fallback | A demo can look more physical than it is | Expose counters for physical fragments versus visual shards |

## Maturity and licensing assessment

Box3DUnreal was created on 2026-07-13 and had roughly three weeks of activity through the reviewed 2026-08-02 commit. It has no tagged release and no repository CI workflow. Its self-checking tests are Unreal console commands rather than registered Unreal automation tests. The plugin could not be compiled in this environment because no Unreal installation or consumer project was available. A standalone build of its pinned Box3D source also failed with the installed older VS2019 C compiler on C17 `_Static_assert`; that is an environment/toolchain mismatch, not evidence that the plugin fails under its documented UE 5.7/5.8 setup.

The Box3DUnreal integration is MIT licensed, and Box3D is also MIT licensed. Reusing code is legally compatible with this repository's MIT license, provided copyright and license notices are preserved. Reimplementing the architectural patterns is still preferable because the Unreal object, build, and asset models do not map directly onto npm, WASM, or Three.js.

## Final recommendation

Continue with our existing Box3D WASM and Three/R3F stack.

Use Box3DUnreal as a design reference for collision baking, stale-asset detection, explicit simulation authority, fixed-step interpolation, debug commands, and topology-aware thinking about rollback. Do not adopt it as a destruction dependency and do not describe its current work as fracture physics.

Our shortest path to a credible open-source destruction feature is:

1. publish the richer contact telemetry already in progress;
2. expose exact convex hull shapes;
3. extract the pure fracture, material, damage, and support-graph logic from `/demolition`;
4. wrap it in a small destruction controller with stable piece IDs and explicit lifecycle events;
5. prove it in one honest, instrumented Three.js example before scaling it to the full city showcase.

That plan preserves the strongest parts of both projects: Box3DUnreal's engine-integration discipline, our web runtime ergonomics, and our application's actual destruction research.

## Research method and source notes

The review combined:

- a recursive source inspection of Box3DUnreal and its pinned Box3D submodule;
- Git history, branch, issue, and repository metadata inspection;
- targeted searches for fracture, damage, contact, impulse, joint, and body-lifecycle paths;
- comparison against published `three-box3d`, its current local working tree, and the committed demolition application sources;
- targeted unit tests and package build/type checks.

Primary external references:

- [Box3DUnreal repository](https://github.com/alattanzio/Box3DUnreal)
- [Box3D repository](https://github.com/erincatto/box3d)
- [Unreal Geometry Collections guide](https://dev.epicgames.com/documentation/en-us/unreal-engine/geometry-collections-user-guide)
- [Unreal fracture tools guide](https://dev.epicgames.com/documentation/unreal-engine/fracturing-geometry-collections-user-guide?lang=en-US)
- [Unreal destruction quick start](https://dev.epicgames.com/documentation/unreal-engine/destruction-quick-start?lang=en-US)

The Unreal documentation is included to make the category boundary explicit: Chaos destruction begins with a Geometry Collection, a fracture hierarchy, a connection graph, strain, and fields. Box3DUnreal intentionally does not implement that layer.
