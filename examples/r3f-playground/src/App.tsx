/**
 * r3f-box3d playground — the declarative brick-stack demo. This is the hooks'
 * proof: a settled tower you click to blast apart, a live HUD, and a reset — all
 * built with r3f-box3d hooks, no manual physics wiring, no per-frame setState,
 * StrictMode ON.
 *
 * The physics render layer (`Bricks`) is the interesting part; everything else is
 * scene dressing (lights, ground, camera).
 */
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  useBox3D,
  useWorld,
  useFixedStep,
  useTransformBuffer,
  useInstancedTransforms,
  SleepManager,
  radialImpulse,
  type BodyHandle,
  type World,
} from 'r3f-box3d';

// ---- verification bridge ----
interface ExampleState {
  ready: boolean;
  bodies: number;
  awake: number;
  worldBodies: number; // total bodies in the world (tower + ground); catches leaks
  fps: number;
  strictMode: boolean;
}
declare global {
  interface Window {
    __exampleState?: ExampleState;
    __exampleBlast?: () => void;
    __exampleReset?: () => void;
  }
}

// ---- brick geometry constants ----
const HALF: [number, number, number] = [0.5, 0.26, 0.5];
const FULL: [number, number, number] = [HALF[0] * 2, HALF[1] * 2, HALF[2] * 2];
const LAYERS = 9; // stacked layers
const PER_LAYER = 8; // bricks per layer (a rotated-course tower)
const MAX_BRICKS = LAYERS * PER_LAYER;

// Warm brick palette with per-brick jitter.
function brickColorAt(i: number, out: THREE.Color): THREE.Color {
  const n = Math.sin(i * 12.9898) * 43758.5453;
  const t = n - Math.floor(n);
  return out.setHSL(0.055 + t * 0.025, 0.42, 0.4 + t * 0.14);
}

/**
 * A Jenga-style tower: each layer is a course of bricks, alternating orientation
 * 90° layer to layer so the stack interlocks and settles into one island.
 */
function towerLayout(): Array<{ pos: [number, number, number]; rotY: number }> {
  const out: Array<{ pos: [number, number, number]; rotY: number }> = [];
  const gap = 1.02;
  for (let layer = 0; layer < LAYERS; layer++) {
    const y = HALF[1] + layer * (HALF[1] * 2 + 0.004);
    const alt = layer % 2 === 1;
    // two rows of four, alternating axis per layer
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 2; b++) {
        const along = (a - 1.5) * gap;
        const across = (b - 0.5) * gap * 1.02;
        const pos: [number, number, number] = alt
          ? [across, y, along]
          : [along, y, across];
        out.push({ pos, rotY: alt ? Math.PI / 2 : 0 });
      }
    }
  }
  return out;
}

// ---- physics render layer ----

function Bricks({
  onStats,
  onReady,
  resetToken,
  registerActions,
}: {
  onStats: (s: { bodies: number; awake: number; fps: number }) => void;
  onReady: () => void;
  resetToken: number;
  registerActions: (a: { blastAt: (p: THREE.Vector3) => void; reset: () => void }) => void;
}) {
  const { camera, gl } = useThree();
  const box3d = useBox3D(); // suspends until WASM ready
  const world = useWorld(box3d, { gravity: [0, -9.81, 0] });

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [bricks, setBricks] = useState<BodyHandle[]>([]);
  const layout = useMemo(() => towerLayout(), []);
  const sleepRef = useRef<SleepManager | null>(null);
  const fpsRef = useRef(60);
  const warmupRef = useRef(0);
  const coloredRef = useRef(false);

  const buffer = useTransformBuffer(bricks, MAX_BRICKS);
  const sync = useInstancedTransforms(meshRef, buffer);

  // Build the ground + tower. Returns every body it created so the effect can tear
  // it all down (StrictMode double-invokes the effect; cleanup makes it idempotent
  // — no orphaned bodies leaking into the world).
  const buildScene = useCallback(
    (w: World): { ground: BodyHandle; bricks: BodyHandle[] } => {
      const ground = w.createBody({ type: 'static' });
      w.addBox(ground, [30, 0.5, 30], { friction: 0.9 });
      const made: BodyHandle[] = [];
      const q = new THREE.Quaternion();
      for (const { pos, rotY } of layout) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
        const body = w.createBody({
          type: 'dynamic',
          position: pos,
          rotation: [q.x, q.y, q.z, q.w],
        });
        w.addBox(body, HALF, { density: 2, friction: 0.8, restitution: 0.02 });
        made.push(body);
      }
      return { ground, bricks: made };
    },
    [layout],
  );

  // Rebuild the scene whenever the world changes OR reset is pressed. The cleanup
  // destroys exactly what this run created, so StrictMode's build→cleanup→build
  // leaves the world with one tower, not two.
  useEffect(() => {
    if (!world) return;
    const { ground, bricks: made } = buildScene(world);
    setBricks(made);
    coloredRef.current = false;
    const sleep = new SleepManager(world, { sweepIntervalSec: 1.2, moveThreshold: 0.008 });
    sleep.watch(made, buffer);
    sleepRef.current = sleep;
    onReady();
    return () => {
      // World may already be gone on a real unmount; guard the destroy calls.
      try {
        for (const b of made) world.destroyBody(b);
        world.destroyBody(ground);
      } catch {
        /* world destroyed — nothing to clean up */
      }
      sleepRef.current = null;
    };
    // buffer identity is stable (useTransformBuffer); rebuild only on world/reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, buildScene, resetToken]);

  // Actions (blast + reset) exposed to the HUD + the verification bridge.
  const blastAt = useCallback(
    (point: THREE.Vector3) => {
      if (!world || bricks.length === 0) return;
      radialImpulse(world, bricks, buffer, {
        center: [point.x, point.y, point.z],
        radius: 3.6,
        strength: 7.5,
        falloff: 'quadratic',
        upwardBias: 0.6,
      });
    },
    [world, bricks, buffer],
  );

  useEffect(() => {
    registerActions({ blastAt, reset: () => {} });
  }, [blastAt, registerActions]);

  // Click-to-blast: raycast the brick mesh (or the ground plane) and blast there.
  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHit = new THREE.Vector3();
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      let point: THREE.Vector3 | null = null;
      const mesh = meshRef.current;
      if (mesh) {
        const hits = raycaster.intersectObject(mesh, false);
        if (hits.length > 0) point = hits[0].point.clone();
      }
      if (!point && raycaster.ray.intersectPlane(groundPlane, planeHit)) {
        point = planeHit.clone();
      }
      if (point) blastAt(point);
    };
    canvas.addEventListener('pointerdown', onDown);
    return () => canvas.removeEventListener('pointerdown', onDown);
  }, [gl, camera, blastAt]);

  // The frame loop: fixed-step the world, run the sleep discipline at step
  // cadence, then read + sync transforms once per rendered frame. No setState.
  const stepper = useFixedStep(world, {
    onStep: (_dt, simTime) => {
      const sleep = sleepRef.current;
      if (sleep) {
        sleep.forceSleepSettled();
        sleep.sweep(simTime);
      }
    },
    onAfterFrame: (stepped) => {
      if (!world) return;

      // One-time per-instance color assignment (after bricks exist).
      const mesh = meshRef.current;
      if (mesh && !coloredRef.current && bricks.length > 0) {
        coloredRef.current = true;
        mesh.count = bricks.length;
        // Generous static bounding sphere so click raycasts always pass broadphase
        // wherever bricks fly (the InstancedMesh raycast footgun).
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 40);
        const c = new THREE.Color();
        for (let i = 0; i < bricks.length; i++) {
          brickColorAt(i, c);
          mesh.setColorAt(i, c);
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }

      if (stepped > 0) {
        buffer.readInto(world);
        sync();
      }
    },
  });
  void stepper;

  // Stats via requestAnimationFrame (fps EMA + throttled HUD pump), kept entirely
  // off React state per frame. A short warmup skips the loading-spiky first frames.
  const statTick = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (dt > 0) {
        warmupRef.current += 1;
        if (warmupRef.current > 6) {
          const inst = 1 / dt;
          fpsRef.current = fpsRef.current <= 0 ? inst : fpsRef.current * 0.9 + inst * 0.1;
        }
      }
      statTick.current += 1;
      if (world && statTick.current % 8 === 0) {
        const bodies = bricks.length;
        const awake = world.awakeBodyCount();
        const fps = Math.round(fpsRef.current);
        onStats({ bodies, awake, fps });
        if (import.meta.env.DEV) {
          window.__exampleState = {
            ready: true,
            bodies,
            awake,
            worldBodies: world.bodyCount(),
            fps,
            strictMode: true,
          };
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [world, bricks.length, onStats]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, MAX_BRICKS]}
      count={0}
      castShadow
      receiveShadow
      frustumCulled={false}
    >
      <boxGeometry args={FULL} />
      {/* vertexColors stays FALSE (default) — setColorAt uses instanceColor. */}
      <meshStandardMaterial roughness={0.72} metalness={0.05} />
    </instancedMesh>
  );
}

// ---- scene dressing ----

// Mottled-asphalt ground texture — matches the vanilla gallery's ground so the
// r3f playground reads as part of the same night scene.
function makeGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0e1015';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 12; i += 1) {
      const bx = Math.random() * 256;
      const by = Math.random() * 256;
      const br = 26 + Math.random() * 44;
      const light = Math.random() < 0.45;
      const grad = ctx.createRadialGradient(bx, by, 2, bx, by, br);
      grad.addColorStop(0, light ? 'rgba(150, 165, 200, 0.06)' : 'rgba(0, 0, 0, 0.32)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 3;
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function Ground() {
  const texture = useMemo(() => makeGroundTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[80, 80]} />
      <meshStandardMaterial map={texture} color="#9aa2b2" roughness={0.97} metalness={0.02} />
    </mesh>
  );
}

function Lights() {
  const targetA = useMemo(() => {
    const t = new THREE.Object3D();
    t.position.set(0, 1.4, 0);
    return t;
  }, []);
  return (
    <>
      <hemisphereLight args={['#3a4c86', '#1a140f', 0.7]} />
      <ambientLight intensity={0.12} color="#5a4630" />
      <primitive object={targetA} />
      <spotLight
        position={[-7, 9, 5]}
        target={targetA}
        color="#ffbd5c"
        intensity={1500}
        angle={0.65}
        penumbra={0.6}
        distance={45}
        decay={1.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0002}
        shadow-camera-near={2}
        shadow-camera-far={45}
      />
      <directionalLight position={[9, 6, -8]} intensity={0.35} color="#6a86d0" />
      <directionalLight position={[6, 4, 8]} intensity={0.22} color="#c08050" />
    </>
  );
}

// ---- HUD ----

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#7c88a8' }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', color: '#e7ecf7', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ bodies: 0, awake: 0, fps: 0 });
  const [resetToken, setResetToken] = useState(0);
  const actionsRef = useRef<{ blastAt: (p: THREE.Vector3) => void; reset: () => void } | null>(null);

  const registerActions = useCallback(
    (a: { blastAt: (p: THREE.Vector3) => void; reset: () => void }) => {
      actionsRef.current = a;
    },
    [],
  );

  // Throttle stats into React state at ~4Hz (the frame loop calls onStats often).
  const pending = useRef(stats);
  const onStats = useCallback((s: { bodies: number; awake: number; fps: number }) => {
    pending.current = s;
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setStats(pending.current), 250);
    return () => window.clearInterval(id);
  }, []);

  const doReset = useCallback(() => setResetToken((t) => t + 1), []);
  const doBlast = useCallback(() => {
    actionsRef.current?.blastAt(new THREE.Vector3(0, 2.4, 0));
  }, []);

  // Verification bridge: let the headed-browser probe drive blast/reset.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__exampleBlast = doBlast;
    window.__exampleReset = doReset;
    return () => {
      delete window.__exampleBlast;
      delete window.__exampleReset;
    };
  }, [doBlast, doReset]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        camera={{ position: [8, 6, 9], fov: 46 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      >
        <color attach="background" args={['#0a0e1a']} />
        <fogExp2 attach="fog" args={['#0a0e1a', 0.02]} />
        <Lights />
        <Ground />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          target={[0, 2.2, 0]}
          minDistance={5}
          maxDistance={26}
          maxPolarAngle={Math.PI * 0.49}
        />
        <Suspense fallback={null}>
          <Bricks
            onStats={onStats}
            onReady={() => setReady(true)}
            resetToken={resetToken}
            registerActions={registerActions}
          />
        </Suspense>
      </Canvas>

      {/* HUD overlay */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          pointerEvents: 'none',
        }}
      >
        <div>
          <div style={{ fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', color: '#8fa0c8' }}>
            r3f-box3d
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#f2f5fc', lineHeight: 1.1 }}>
            Playground
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 26,
            padding: '14px 18px',
            background: 'rgba(14, 20, 38, 0.72)',
            border: '1px solid rgba(120, 140, 190, 0.18)',
            borderRadius: 14,
            backdropFilter: 'blur(8px)',
          }}
          data-testid="hud"
        >
          <Stat label="Bodies" value={stats.bodies.toString()} />
          <Stat label="Awake" value={stats.awake.toString()} />
          <Stat label="FPS" value={stats.fps > 0 ? stats.fps.toString() : '—'} />
        </div>
      </div>

      {/* controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
        }}
      >
        <button
          type="button"
          data-testid="blast"
          onClick={doBlast}
          style={buttonStyle('#ff8a3d')}
        >
          Blast center
        </button>
        <button
          type="button"
          data-testid="reset"
          onClick={doReset}
          style={buttonStyle('#5a6f9c')}
        >
          Reset
        </button>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 24,
          right: 24,
          fontSize: 12,
          color: '#6b7796',
          textAlign: 'right',
          maxWidth: 220,
          pointerEvents: 'none',
        }}
      >
        Click a brick to blast it. Drag to orbit.
      </div>

      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#9fb0d8',
            fontSize: 15,
            letterSpacing: 1,
          }}
        >
          Loading physics…
        </div>
      )}
    </div>
  );
}

function buttonStyle(accent: string): React.CSSProperties {
  return {
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    color: '#0a0e1a',
    background: accent,
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  };
}
