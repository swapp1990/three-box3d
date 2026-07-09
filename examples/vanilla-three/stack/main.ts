/**
 * Brick stack — the flagship example. A settled wall of bricks you can
 * click-impulse via a radial blast. Demonstrates: FixedStepper, TransformBuffer,
 * SleepManager (island-aware sleep so a settled wall costs ~0 step time),
 * InstancedMesh sync, and radialImpulse (the native-explode workaround).
 */
import {
  BoxGeometry,
  Clock,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  createBox3D,
  FixedStepper,
  TransformBuffer,
  SleepManager,
  radialImpulse,
  type BodyHandle,
  type World,
} from 'box3d-web';
import { writeTransformsToInstancedMesh } from 'three-box3d';
import { createBaseScene, addGroundPlane } from '../shared/scene.js';
import { createHud, addHint, addSourceLink, addBackLink } from '../shared/hud.js';

addSourceLink('stack/main.ts');
addBackLink();
addHint('Click a brick to blast it — drag to orbit, scroll to zoom');
const hud = createHud('Brick Stack');

const { scene, camera, renderer } = createBaseScene({ cameraPosition: [9, 7, 11] });
renderer.shadowMap.type = PCFSoftShadowMap;
addGroundPlane(scene, 60);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;

// ---- physics world ----
const b3 = await createBox3D();
const world: World = b3.createWorld({ gravity: [0, -9.81, 0] });

const ground = world.createBody({ type: 'static' });
world.addBox(ground, [30, 0.5, 30], { friction: 0.85 });

// 8 rows x 6 columns brick wall.
const ROWS = 8;
const COLS = 6;
const HALF: [number, number, number] = [0.5, 0.25, 0.28];
const bricks: BodyHandle[] = [];

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const body = world.createBody({
      type: 'dynamic',
      position: [(col - (COLS - 1) / 2) * 1.04, 0.5 + row * 0.52, 0],
    });
    world.addBox(body, HALF, { density: 2, friction: 0.7 });
    bricks.push(body);
  }
}

const buffer = new TransformBuffer(bricks.length);
for (const b of bricks) buffer.add(b);

const sleep = new SleepManager(world, { sweepIntervalSec: 1.5, moveThreshold: 0.008 });
sleep.watch(bricks, buffer);

// ---- rendering: one InstancedMesh, vertexColors stays FALSE (see three-box3d docs) ----
const geometry = new BoxGeometry(HALF[0] * 2, HALF[1] * 2, HALF[2] * 2);
const material = new MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }); // vertexColors: false (default) — setColorAt below relies on this
const mesh = new InstancedMesh(geometry, material, bricks.length);
mesh.castShadow = true;
mesh.receiveShadow = true;
// InstancedMesh.raycast() lazily computes a whole-mesh bounding sphere ONCE and
// caches it — if that first compute happens before any transform has been
// written (count could still be effectively 0 matrices), the cached sphere
// collapses to roughly the origin and every later click-raycast silently
// misses. Pin a static, generous sphere up front so raycasts always reach the
// per-instance broadphase test, wherever the bricks end up.
mesh.boundingSphere = new Sphere(new Vector3(0, 2, 0), 12);
scene.add(mesh);

// Warm terracotta bricks with per-brick jitter, plus the occasional cool-slate
// or gold accent course so the wall reads as varied masonry, not one flat tone.
// (All via setColorAt / instanceColor — vertexColors stays false, see above.)
const brickColor = new Color();
for (let i = 0; i < bricks.length; i++) {
  const jitter = Math.sin(i * 12.9898) * 43758.5453;
  const t = jitter - Math.floor(jitter);
  const accent = Math.sin(i * 78.233) * 43758.5453;
  const a = accent - Math.floor(accent);
  if (a > 0.9) {
    brickColor.setHSL(0.11, 0.62, 0.46 + t * 0.08); // gold accent brick
  } else if (a > 0.8) {
    brickColor.setHSL(0.6, 0.22, 0.36 + t * 0.08); // cool slate brick
  } else {
    brickColor.setHSL(0.045 + t * 0.03, 0.55, 0.36 + t * 0.12); // terracotta
  }
  mesh.setColorAt(i, brickColor);
}
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

// ---- click-to-blast ----
const raycaster = new Raycaster();
const ndc = new Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(mesh);
  if (hit.length === 0) return;
  const point = hit[0].point;
  radialImpulse(world, bricks, buffer, {
    center: [point.x, point.y, point.z],
    radius: 3.5,
    strength: 6,
    upwardBias: 0.5,
  });
});

// ---- fixed-step loop ----
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

  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);
    sleep.forceSleepSettled();
    sleep.sweep(stepper.simTime);
  });

  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);
    writeTransformsToInstancedMesh(mesh, buffer);
  }

  controls.update();
  renderer.render(scene, camera);

  fps = fps * 0.9 + (delta > 0 ? 1 / delta : fps) * 0.1;
  const awake = world.awakeBodyCount();
  hud.update([
    { label: 'bodies', value: bricks.length },
    { label: 'awake', value: awake },
    { label: 'fps', value: fps.toFixed(0) },
  ]);

  if (import.meta.env.DEV) {
    window.__exampleState = { bodies: bricks.length, awake, fps };
  }
}

frame();
