/**
 * Shared minimal three.js scene bootstrap: renderer, camera, lights, resize
 * handling. Every example calls this once, then adds its own geometry/physics.
 * No framework — plain three.js, matching the "examples are the product, keep
 * dependencies at zero beyond three + the workspace packages" rule.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Fog,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export interface BaseScene {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
}

export function createBaseScene(options: { cameraPosition?: [number, number, number] } = {}): BaseScene {
  const scene = new Scene();
  scene.background = null;
  scene.fog = new Fog(0x0a0b0f, 20, 70);

  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  const [cx, cy, cz] = options.cameraPosition ?? [8, 6, 12];
  camera.position.set(cx, cy, cz);
  camera.lookAt(0, 1, 0);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
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

  const ambient = new AmbientLight(0x8899cc, 0.55);
  scene.add(ambient);

  const sun = new DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const rim = new DirectionalLight(0x6ea8ff, 0.4);
  rim.position.set(-8, 4, -6);
  scene.add(rim);

  return { scene, camera, renderer, canvas: renderer.domElement };
}

export function addGroundPlane(scene: Scene, size = 60): Mesh {
  const ground = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({ color: 0x14161c, roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  return ground;
}
