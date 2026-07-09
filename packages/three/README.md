# three-box3d

The flagship three.js adapter for [box3d-web](https://www.npmjs.com/package/box3d-web) —
3D physics for three.js, powered by [box3d](https://github.com/erincatto/box3d) (Erin Catto).

`box3d-web` never imports `three`; this package is the boundary. It copies flat
`TransformBuffer` floats into `Object3D`/`InstancedMesh` and builds camera rays for
raycasting — it owns no simulation state.

```bash
npm install three-box3d box3d-web three
```

## API

- `applyTransformToObject3D(obj, buffer, body)` — copy one body's pose into a plain
  `Object3D` (mesh, group, ...). Good for a handful of tracked objects.
- `writeTransformsToInstancedMesh(mesh, buffer, opts?)` — bulk-write every tracked
  body into an `InstancedMesh`'s per-instance matrices in one call, flags
  `instanceMatrix.needsUpdate`. This is the one that matters for hundreds/thousands
  of bodies — one draw call, no per-body allocation.
- `hiddenInstanceMatrix()` — a zero-scale sentinel matrix for parking an unused
  instance slot (pooled/inactive bodies).
- `toVec3(vector3)` — `THREE.Vector3` → box3d-web's plain `[x, y, z]` tuple.
- `raycastFromCamera(world, camera, ndcX, ndcY, maxDistance?)` — unproject a camera
  ray at NDC coordinates and cast it into a box3d-web `World`.

### The `vertexColors` footgun

If you tint instances with `mesh.setColorAt(i, color)`, the material must **not**
set `vertexColors: true` unless you also supply a per-vertex color attribute on the
geometry. With `vertexColors: true` and no color attribute, three.js silently
multiplies every instance's color by black — every instance renders solid black.
This exact bug hit three separate meshes in the dogfood app before the rule got
written down. The default (`vertexColors: false`) works correctly with
`setColorAt`/`instanceColor` — just don't turn it on.

```ts
const mat = new THREE.MeshStandardMaterial(); // vertexColors stays false — correct
mesh.setColorAt(i, color); // fine, this is instanceColor, not vertex colors
```

## Quickstart

```ts
import { createBox3D, FixedStepper, TransformBuffer, SleepManager } from 'box3d-web';
import { writeTransformsToInstancedMesh } from 'three-box3d';
import * as THREE from 'three';

const b3 = await createBox3D();
const world = b3.createWorld({ gravity: [0, -9.81, 0] });
const buffer = new TransformBuffer(64);
// ... create bodies, buffer.add(body) ...

const mesh = new THREE.InstancedMesh(geometry, material, bodies.length);
const stepper = new FixedStepper();

function frame(delta: number) {
  const stepped = stepper.advance(delta, (dt) => world.step(dt));
  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);
    writeTransformsToInstancedMesh(mesh, buffer);
  }
}
```

See `examples/vanilla-three/` in the monorepo for full working pages (brick stack,
ball drop, raycast pick, contact-event pulse).

Status: v0.1 — see the monorepo's `docs/api-design.md` for the frozen `box3d-web`
contract this package builds on.
