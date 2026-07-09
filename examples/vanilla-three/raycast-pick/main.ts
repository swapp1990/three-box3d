/**
 * Raycast pick — click to pick a body via `raycastFromCamera` (three-box3d's
 * camera→physics-ray helper, built on box3d-web's `World.castRayClosest`) and
 * apply an impulse at the hit point. Unlike the stack example (which raycasts
 * against the three.js mesh with THREE.Raycaster), this queries the PHYSICS WORLD
 * directly — useful when you don't want a render-side raycast at all, or want to
 * pick against bodies that have no corresponding visible mesh.
 */
import { Clock, Color, InstancedMesh, MeshStandardMaterial, SphereGeometry, Vector2 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createBox3D, FixedStepper, TransformBuffer, type BodyHandle, type World } from 'box3d-web';
import { writeTransformsToInstancedMesh, raycastFromCamera } from 'three-box3d';
import { createBaseScene, addGroundPlane } from '../shared/scene.js';
import { createHud, addHint, addSourceLink, addBackLink } from '../shared/hud.js';

addSourceLink('raycast-pick/main.ts');
addBackLink();
addHint('Click a sphere to pick it via castRayClosest — impulse launches it up');
const hud = createHud('Raycast Pick');

const { scene, camera, renderer } = createBaseScene({ cameraPosition: [8, 6, 10] });
addGroundPlane(scene, 30);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;

const b3 = await createBox3D();
const world: World = b3.createWorld({ gravity: [0, -9.81, 0] });

const ground = world.createBody({ type: 'static' });
world.addBox(ground, [15, 0.5, 15], { friction: 0.7 });

const RADIUS = 0.4;
const GRID = 5;
const bodies: BodyHandle[] = [];

for (let x = 0; x < GRID; x++) {
  for (let z = 0; z < GRID; z++) {
    const body = world.createBody({
      type: 'dynamic',
      position: [(x - (GRID - 1) / 2) * 1.4, 1.5 + Math.random() * 0.5, (z - (GRID - 1) / 2) * 1.4],
    });
    world.addSphere(body, RADIUS, { density: 1, friction: 0.5, restitution: 0.4 });
    bodies.push(body);
  }
}

const buffer = new TransformBuffer(bodies.length);
for (const b of bodies) buffer.add(b);

const geometry = new SphereGeometry(RADIUS, 24, 18);
const material = new MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, color: 0x6ea8ff }); // vertexColors stays false
const mesh = new InstancedMesh(geometry, material, bodies.length);
mesh.castShadow = true;
mesh.receiveShadow = true;
scene.add(mesh);

const pickColor = new Color(0xff8a5c);
const baseColor = new Color(0x6ea8ff);
for (let i = 0; i < bodies.length; i++) mesh.setColorAt(i, baseColor);
if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

let lastPicked: BodyHandle | null = null;
let flashUntil = 0;

const ndc = new Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  const hit = raycastFromCamera(world, camera, ndc.x, ndc.y, 100);
  if (!hit) return;

  world.applyImpulse(hit.body, [0, 5.5, 0], [hit.point.x, hit.point.y, hit.point.z]);
  lastPicked = hit.body;
  flashUntil = performance.now() + 220;
});

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
  });

  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);
    writeTransformsToInstancedMesh(mesh, buffer);
  }

  // Flash the picked sphere briefly so the pick is visually obvious.
  if (lastPicked !== null) {
    const ids = buffer.ids;
    const idx = ids.indexOf(lastPicked);
    if (idx !== -1) {
      mesh.setColorAt(idx, performance.now() < flashUntil ? pickColor : baseColor);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (performance.now() >= flashUntil) lastPicked = null;
  }

  controls.update();
  renderer.render(scene, camera);

  fps = fps * 0.9 + (delta > 0 ? 1 / delta : fps) * 0.1;
  const awake = world.awakeBodyCount();
  hud.update([
    { label: 'bodies', value: bodies.length },
    { label: 'awake', value: awake },
    { label: 'fps', value: fps.toFixed(0) },
  ]);

  if (import.meta.env.DEV) {
    window.__exampleState = { bodies: bodies.length, awake, fps };
  }
}

frame();
