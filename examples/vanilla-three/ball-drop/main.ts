/**
 * Ball drop — spheres rain onto a floor, capped by a BodyPool (destroys the
 * oldest ball once the cap is hit, so the demo never grows unbounded). One
 * fixed-size InstancedMesh; unused pool slots beyond the current ball count are
 * parked with the `hiddenInstanceMatrix` sentinel via `writeTransformsToInstancedMesh`'s
 * `hide` option.
 */
import { Clock, Color, InstancedMesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createBox3D,
  FixedStepper,
  TransformBuffer,
  BodyPool,
  type BodyHandle,
  type World,
} from 'box3d-web';
import { writeTransformsToInstancedMesh } from 'three-box3d';
import { createBaseScene, addGroundPlane } from '../shared/scene.js';
import { createHud, addHint, addSourceLink, addBackLink } from '../shared/hud.js';

addSourceLink('ball-drop/main.ts');
addBackLink();
addHint('Balls keep raining — the pool caps at 120 and evicts the oldest');
const hud = createHud('Ball Drop');

const { scene, camera, renderer } = createBaseScene({ cameraPosition: [10, 8, 14] });
addGroundPlane(scene, 40);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;

const b3 = await createBox3D();
const world: World = b3.createWorld({ gravity: [0, -9.81, 0] });

const ground = world.createBody({ type: 'static' });
world.addBox(ground, [20, 0.5, 20], { friction: 0.6, restitution: 0.15 });

const RADIUS = 0.28;
const MAX_BALLS = 120;

const buffer = new TransformBuffer(MAX_BALLS);

const pool = new BodyPool(world, {
  max: MAX_BALLS,
  onEvict: (body) => buffer.remove(body),
});

function spawnBall(): void {
  const x = (Math.random() - 0.5) * 6;
  const z = (Math.random() - 0.5) * 6;
  // BodyPool's `spawn` callback param is typed as the minimal WorldLike it needs
  // (destroyBody only) — close over the real `world` for createBody instead.
  const body = pool.spawn(() =>
    world.createBody({ type: 'dynamic', position: [x, 10 + Math.random() * 4, z] }),
  );
  world.addSphere(body, RADIUS, { density: 1.2, friction: 0.5, restitution: 0.35 });
  buffer.add(body);
}

// ---- rendering ----
const geometry = new SphereGeometry(RADIUS, 20, 16);
const material = new MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }); // vertexColors stays false
const mesh = new InstancedMesh(geometry, material, MAX_BALLS);
mesh.castShadow = true;
mesh.receiveShadow = true;
scene.add(mesh);

const colorPalette = [0x6ea8ff, 0xff8a5c, 0x7de3a8, 0xffd166, 0xd68aff];
// Keyed by body handle (stable for the ball's lifetime) so its color doesn't
// shift when TransformBuffer renumbers slots on eviction — only the mesh
// instance INDEX a color is written to changes, not which color a body owns.
const colorByBody = new Map<BodyHandle, Color>();
let nextColorIndex = 0;

// ---- spawn cadence ----
let spawnTimer = 0;
const SPAWN_INTERVAL = 0.25;

const stepper = new FixedStepper();
const clock = new Clock();

declare global {
  interface Window {
    __exampleState?: { bodies: number; awake: number; fps: number };
  }
}

let fps = 60;

function frame(): void {
  requestAnimationFrame(frame);
  const delta = clock.getDelta();

  spawnTimer += delta;
  while (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer -= SPAWN_INTERVAL;
    spawnBall();
  }

  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);
  });

  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);

    // Each body keeps its color for its lifetime, but slot INDICES renumber
    // whenever a ball is evicted (TransformBuffer compacts on rebuild) — so
    // re-derive index->color from the current id order every rebuild rather
    // than caching by index. Cheap at <=120 balls.
    const ids = buffer.ids;
    for (let i = 0; i < ids.length; i++) {
      const body = ids[i] as BodyHandle;
      let color = colorByBody.get(body);
      if (!color) {
        color = new Color(colorPalette[nextColorIndex % colorPalette.length]);
        nextColorIndex += 1;
        colorByBody.set(body, color);
      }
      mesh.setColorAt(i, color);
    }
    // Prune colors for bodies no longer tracked (evicted by the pool).
    if (colorByBody.size > ids.length) {
      const live = new Set(ids);
      for (const body of colorByBody.keys()) {
        if (!live.has(body)) colorByBody.delete(body);
      }
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    mesh.count = buffer.count;
    writeTransformsToInstancedMesh(mesh, buffer);
  }

  controls.update();
  renderer.render(scene, camera);

  fps = fps * 0.9 + (delta > 0 ? 1 / delta : fps) * 0.1;
  const awake = world.awakeBodyCount();
  hud.update([
    { label: 'bodies', value: buffer.count },
    { label: 'awake', value: awake },
    { label: 'fps', value: fps.toFixed(0) },
  ]);

  if (import.meta.env.DEV) {
    window.__exampleState = { bodies: buffer.count, awake, fps };
  }
}

frame();
