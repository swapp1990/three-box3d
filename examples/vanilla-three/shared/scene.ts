/**
 * Shared three.js scene bootstrap for the example gallery: renderer, camera, the
 * gallery's night/gold lighting identity, a mottled ground, and resize handling.
 * Every example calls `createBaseScene` once, then adds its own geometry/physics.
 *
 * No framework, no extra deps — plain three.js, matching the "examples are the
 * product, keep dependencies at zero beyond three + the workspace packages" rule.
 *
 * The lighting is adapted from the dogfood app's proven /physics-playground
 * treatment: a warm amber key spot, a cool blue rim, a low warm camera-side fill,
 * and a hemisphere that keeps shadowed faces reading as dark terracotta rather
 * than crushed black. Spot lights use physically-correct `decay`, so the ACES
 * tone-mapped result has the same warm pool + cool edge the app ships.
 */
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SpotLight,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export interface BaseScene {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
}

const BG = 0x0a0b0f;

export function createBaseScene(
  options: { cameraPosition?: [number, number, number]; lookAt?: [number, number, number] } = {},
): BaseScene {
  const scene = new Scene();
  scene.background = new Color(BG);
  // Fog fades the far edges of the ground into the background so it reads as a
  // pool of light in the dark, not a plane floating in a void.
  scene.fog = new Fog(BG, 24, 78);

  const camera = new PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);
  const [cx, cy, cz] = options.cameraPosition ?? [8, 6, 12];
  camera.position.set(cx, cy, cz);
  const [lx, ly, lz] = options.lookAt ?? [0, 1.5, 0];
  camera.lookAt(lx, ly, lz);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app container in index.html');
  app.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  addLighting(scene);

  return { scene, camera, renderer, canvas: renderer.domElement };
}

/**
 * The gallery's night/gold rig. One warm amber key spot casts the shadows, a
 * cool blue rim separates bodies from the dark background, a low warm fill from
 * the camera side keeps shadowed faces on-palette, and a hemisphere provides the
 * warm-terracotta / cool-sky bounce.
 */
function addLighting(scene: Scene): void {
  const hemi = new HemisphereLight(0x2f4478, 0x241812, 0.7);
  scene.add(hemi);

  const target = new Object3D();
  target.position.set(0, 1.2, 0);
  scene.add(target);

  // Warm amber key — the shadow caster. (color, intensity, distance, angle, penumbra, decay)
  // Intensity tuned (QA rounds 1–2) so lit faces keep their albedo hue instead
  // of blowing out to cream under ACES — the palette variance must stay legible.
  const key = new SpotLight(0xffc370, 880, 46, 0.62, 0.6, 1.7);
  key.position.set(-8, 10, 5);
  key.target = target;
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 46;
  key.shadow.bias = -0.0002;
  scene.add(key);

  // Cool blue rim from the far side — edge separation, no shadow (cheap).
  const rim = new DirectionalLight(0x6a86d0, 0.4);
  rim.position.set(11, 7, -9);
  scene.add(rim);

  // Low warm camera-side fill — keeps camera-facing shadow sides from going navy.
  const fill = new DirectionalLight(0xc08050, 0.24);
  fill.position.set(7, 4.5, 8.5);
  scene.add(fill);
}

/**
 * A generated mottled-asphalt ground texture: dark base, faint tonal blotches,
 * fine speckle, and paving seams. Sells "a lit pool on a dark floor" far better
 * than a flat color, and reuses the app's proven canvas-texture approach so the
 * gallery reads as one coherent night scene.
 */
function makeGroundTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0e1015';
    ctx.fillRect(0, 0, 256, 256);
    // Tonal blotches so the lit area doesn't read as a flat gradient.
    for (let i = 0; i < 12; i += 1) {
      const bx = Math.random() * 256;
      const by = Math.random() * 256;
      const br = 26 + Math.random() * 44;
      const light = Math.random() < 0.45;
      const grad = ctx.createRadialGradient(bx, by, 2, bx, by, br);
      grad.addColorStop(0, light ? 'rgba(160, 175, 205, 0.11)' : 'rgba(0, 0, 0, 0.42)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // Fine speckle grain.
    for (let i = 0; i < 200; i += 1) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const w = 2 + Math.random() * 18;
      const h = 1 + Math.random() * 2.5;
      ctx.fillStyle = Math.random() < 0.45 ? 'rgba(160, 175, 205, 0.1)' : 'rgba(0, 0, 0, 0.36)';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    // Paving seams.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 4;
    for (let p = 0; p <= 256; p += 64) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(256, p);
      ctx.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function addGroundPlane(scene: Scene, size = 60): Mesh {
  const ground = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({
      map: makeGroundTexture(),
      color: 0x9aa2b2,
      roughness: 0.96,
      metalness: 0.02,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}
