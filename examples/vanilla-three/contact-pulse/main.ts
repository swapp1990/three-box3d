/**
 * Contact pulse — cubes tumble onto the floor; every contact-begin event flashes
 * the touched instance's color via `setColorAt`, scaled by impact approach speed.
 * This is the correct, deliberate use of `setColorAt` alongside an InstancedMesh:
 * the material below is a plain MeshStandardMaterial with `vertexColors` left at
 * its default `false` — see three-box3d's JSDoc/README for why turning that on
 * (without a per-vertex color attribute) makes every instance render solid black.
 */
import { Clock, Color, InstancedMesh, MeshStandardMaterial, BoxGeometry } from 'three';
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

addSourceLink('contact-pulse/main.ts');
addBackLink();
addHint('Cubes flash on impact — brighter flash = harder hit (approachSpeed)');
const hud = createHud('Contact Pulse');

const { scene, camera, renderer } = createBaseScene({ cameraPosition: [9, 7, 12] });
addGroundPlane(scene, 30);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;

const b3 = await createBox3D();
const world: World = b3.createWorld({ gravity: [0, -9.81, 0] });

const ground = world.createBody({ type: 'static' });
world.addBox(ground, [15, 0.5, 15], { friction: 0.6 });

const HALF: [number, number, number] = [0.35, 0.35, 0.35];
const MAX_CUBES = 60;

const buffer = new TransformBuffer(MAX_CUBES);
const pool = new BodyPool(world, { max: MAX_CUBES, onEvict: (body) => buffer.remove(body) });

function spawnCube(): void {
  const x = (Math.random() - 0.5) * 5;
  const z = (Math.random() - 0.5) * 5;
  // BodyPool's `spawn` callback param is typed as the minimal WorldLike it needs
  // (destroyBody only) — close over the real `world` for createBody instead.
  const body = pool.spawn(() =>
    world.createBody({
      type: 'dynamic',
      position: [x, 8 + Math.random() * 3, z],
      rotation: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, 1],
    }),
  );
  world.addBox(body, HALF, { density: 1.5, friction: 0.5, restitution: 0.2 });
  buffer.add(body);
}

const geometry = new BoxGeometry(HALF[0] * 2, HALF[1] * 2, HALF[2] * 2);
const material = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 }); // vertexColors stays false — required for setColorAt to work correctly
const mesh = new InstancedMesh(geometry, material, MAX_CUBES);
mesh.castShadow = true;
mesh.receiveShadow = true;
scene.add(mesh);

const baseColor = new Color(0x8a90a2);
const flashColor = new Color(0xffe082);
// body -> { start, until, strength } so multiple simultaneous impacts each get
// their own fade without stomping each other.
const flashes = new Map<BodyHandle, { start: number; until: number; strength: number }>();

let spawnTimer = 0;
const SPAWN_INTERVAL = 0.4;

const stepper = new FixedStepper();
const clock = new Clock();
const tmpColor = new Color();

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
    if (buffer.count < MAX_CUBES) spawnCube();
  }

  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);
    for (const event of world.drainContactBeginEvents()) {
      const strength = Math.min(1, event.approachSpeed / 6);
      const now = performance.now();
      const flashDuration = 90 + strength * 180;
      for (const body of [event.bodyA, event.bodyB]) {
        const existing = flashes.get(body);
        if (!existing || existing.strength < strength) {
          flashes.set(body, { start: now, until: now + flashDuration, strength });
        }
      }
    }
  });

  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);
    mesh.count = buffer.count;
    writeTransformsToInstancedMesh(mesh, buffer);
  }

  // Apply flash colors, fading out as they expire.
  const now = performance.now();
  const ids = buffer.ids;
  for (let i = 0; i < ids.length; i++) {
    const body = ids[i] as BodyHandle;
    const flash = flashes.get(body);
    if (flash && now < flash.until) {
      const elapsed = now - flash.start;
      const duration = flash.until - flash.start;
      const fade = 1 - Math.max(0, Math.min(1, elapsed / duration)); // 1 → 0 over the flash window
      tmpColor.copy(baseColor).lerp(flashColor, flash.strength * fade);
      mesh.setColorAt(i, tmpColor);
    } else {
      if (flash) flashes.delete(body);
      mesh.setColorAt(i, baseColor);
    }
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

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
