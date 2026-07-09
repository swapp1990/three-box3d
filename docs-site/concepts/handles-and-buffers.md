# Worlds, handles & buffers

The core's whole shape follows from one decision: **it is buffer-oriented, not object-oriented.** Understanding worlds, handles, and the transform buffer is understanding the library.

## Worlds

`createBox3D()` gives you a `Box3D` — a loaded module that owns the WASM memory and scratch buffers. From it you create worlds:

```ts
const b3 = await createBox3D();
const world = b3.createWorld({ gravity: [0, -9.81, 0] });
```

A `World` is a thin **method bag** bound to a world handle. It holds no per-body state of its own — it's just the call surface. You can create multiple worlds per module, and multiple independent modules. When you're done, `world.destroy()` frees the world and everything in it; `b3.dispose()` frees the module.

The coordinate system matches three.js: **right-handed, Y-up, meters/kilograms/seconds**, quaternions in `(x, y, z, w)` order — so nothing needs reordering crossing the boundary.

## Handles, not objects

Bodies, shapes and joints are not JavaScript objects. They are **branded opaque integers**:

```ts
const body: BodyHandle = world.createBody({ type: 'dynamic', position: [0, 5, 0] });
const shape: ShapeHandle = world.addBox(body, [0.5, 0.5, 0.5]);
```

Branding is compile-time only. At runtime a `BodyHandle` *is* the raw integer the bridge returned — zero allocation, zero wrapper. But the type system won't let you pass a `BodyHandle` where a `WorldHandle` is expected; that's a type error caught before you run.

::: warning The primary footgun: cross-world handles
Handles are branded by *kind*, not by *world*. A `BodyHandle` created in world A is a valid-looking integer that will silently alias a **different** body if you pass it to world B's methods — the type system can't catch this, and the bridge treats it as any other slot lookup. **Keep handles scoped to the world that created them.** (A DEV-only build that tags handles with their world and throws on mismatch is a v0.5 candidate.)
:::

Invalid or destroyed handles are defined as **no-ops** (or return `0` / `-1` / `null`) at the bridge — using a handle after `destroy*` is safe, not undefined behavior.

## The transform buffer

This is the core idea. box3d can simulate thousands of bodies; a JavaScript object per body is exactly the thing that kills the InstancedMesh story. So there is **no `Body` class, no scene mirror, no per-body reactive wrapper**. Instead, the read path is one bulk copy into a flat `Float32Array`:

```
per body: [ x, y, z,  qx, qy, qz, qw ]   ← 7 floats
```

`World.readTransforms(ids, out)` fills that layout for every id in one call. The `TransformBuffer` helper wraps the bookkeeping — the packed id array, the 7-float pose array, and a dirty-rebuild:

```ts
const buffer = new TransformBuffer(64);
for (const b of bricks) buffer.add(b);
// once per step:
buffer.rebuild();       // recompute the packed id array if bodies were added/removed
buffer.readInto(world); // one bulk read into buffer.transforms
```

Then the adapter copies those floats straight into an `InstancedMesh` — one draw call for the whole wall.

::: warning Slots are not stable across rebuilds
Bodies are insertion-ordered and the packed arrays are **compacted on rebuild**. Removing a body **renumbers** every body after it — slot indices are not stable. Never cache an index or byte offset across a rebuild; always resolve a body's position through `buffer.offsetOf(body)`.
:::

This is why the API is shaped the way it is: the flat buffer is the contract between the physics core and every renderer, and it's the reason syncing thousands of bodies costs one copy and one draw call instead of thousands of object reads.

## Events accumulate until drained

Contact-begin and sensor events are not fire-once callbacks — they **accumulate** in a queue until you drain them. A drain returns everything since the previous drain and empties the queue. The recommended pattern is one drain per `step()`:

```ts
world.step(dt);
for (const e of world.drainContactBeginEvents()) {
  // e.bodyA, e.bodyB, e.approachSpeed  — scale VFX/sound by approachSpeed
}
```

Allocation-free `...Into(buffer)` variants exist for the hot path, but the object-returning drains are the documented default.
