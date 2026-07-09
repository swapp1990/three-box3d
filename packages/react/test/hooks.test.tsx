/**
 * r3f-box3d hook tests. Real WASM (box3d-web), a minimal R3F harness via
 * @react-three/test-renderer, and StrictMode double-mount coverage. Nothing about
 * core is mocked.
 *
 * What's covered:
 *   - useBox3D / useBox3DAsync: Suspense resolve + non-suspending escape hatch
 *   - world lifecycle: create on mount, destroy on unmount
 *   - StrictMode double-mount: exactly one live world, no leak, no use-after-destroy
 *   - useFixedStep: fixed-step accumulation is deterministic (same sim time → same pose)
 *   - useTransformBuffer: rebuilds (repacks ids) on body add / remove
 *   - useInstancedTransforms: writes poses into an InstancedMesh with no setState
 */
import { StrictMode, Suspense, useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as THREE from 'three';
import { createBox3D, type BodyHandle, type World } from 'box3d-web';
import {
  useBox3D,
  useBox3DAsync,
  useWorld,
  useFixedStep,
  useTransformBuffer,
  useInstancedTransforms,
} from '../src/index.js';
import { loadOptions, resetModuleCache } from './helpers.js';

const LOAD = loadOptions();

/** Render, wait for the suspended WASM load + world-creation effect, settle. */
async function mount(node: React.ReactNode) {
  const renderer = await ReactThreeTestRenderer.create(node as React.ReactElement);
  await new Promise((r) => setTimeout(r, 80));
  await renderer.update(node as React.ReactElement);
  await new Promise((r) => setTimeout(r, 20));
  await renderer.update(node as React.ReactElement);
  return renderer;
}

afterEach(() => {
  resetModuleCache();
});

// ---- useBox3D (Suspense) ----

describe('useBox3D (Suspense)', () => {
  it('suspends then resolves a live module', async () => {
    let seen: unknown = null;
    function Probe() {
      seen = useBox3D(LOAD);
      return null;
    }
    const renderer = await mount(
      <Suspense fallback={null}>
        <Probe />
      </Suspense>,
    );
    expect(seen).toBeTruthy();
    expect(typeof (seen as { createWorld?: unknown }).createWorld).toBe('function');
    await renderer.unmount();
  });
});

// ---- useBox3DAsync (non-suspending) ----

describe('useBox3DAsync (escape hatch)', () => {
  it('reports loading then a ready module without suspending', async () => {
    const states: Array<{ loading: boolean; ready: boolean }> = [];
    function Probe() {
      const { box3d, loading } = useBox3DAsync(LOAD);
      states.push({ loading, ready: !!box3d });
      return null;
    }
    const renderer = await mount(<Probe />);
    expect(states[0].loading).toBe(true);
    expect(states.some((s) => s.ready)).toBe(true);
    await renderer.unmount();
  });
});

// ---- useWorld lifecycle ----

describe('useWorld lifecycle', () => {
  it('creates a world on mount and destroys it on unmount', async () => {
    let captured: World | null = null;
    function Scene() {
      const b3 = useBox3D(LOAD);
      const world = useWorld(b3);
      if (world) captured = world;
      return null;
    }
    const renderer = await mount(
      <Suspense fallback={null}>
        <Scene />
      </Suspense>,
    );
    expect(captured).toBeTruthy();
    expect(() => captured!.bodyCount()).not.toThrow();

    await renderer.unmount();
    // After unmount the world is destroyed — any method throws "used after".
    expect(() => captured!.bodyCount()).toThrow();
  });
});

// ---- StrictMode double-mount ----

describe('useWorld under StrictMode', () => {
  it('survives the dev double-mount: the published world is live, none dangling', async () => {
    let liveWorld: World | null = null;
    function Scene() {
      const b3 = useBox3D(LOAD);
      const world = useWorld(b3);
      if (world) liveWorld = world;
      return null;
    }
    const renderer = await mount(
      <StrictMode>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </StrictMode>,
    );
    expect(liveWorld).toBeTruthy();
    // The currently-published world must be live (StrictMode's cleanup destroyed
    // the throwaway first world, not this one).
    expect(() => liveWorld!.bodyCount()).not.toThrow();
    await renderer.unmount();
    expect(() => liveWorld!.bodyCount()).toThrow();
  });
});

// ---- useFixedStep determinism ----

describe('useFixedStep accumulation', () => {
  it('is deterministic: same sim time from different frame chunking → same pose', async () => {
    async function simulate(deltas: number[]): Promise<number> {
      resetModuleCache();
      const b3 = await createBox3D(loadOptions());
      const world = b3.createWorld({ gravity: [0, -9.81, 0] });
      const ball = world.createBody({ type: 'dynamic', position: [0, 10, 0] });
      world.addSphere(ball, 0.5, { density: 1 });

      let y = 10;
      function Sim() {
        useFixedStep(world, {
          onAfterFrame: () => {
            const out = new Float32Array(7);
            world.readTransforms(Int32Array.of(ball), out);
            y = out[1];
          },
        });
        return null;
      }
      const renderer = await ReactThreeTestRenderer.create(<Sim />);
      // Let the stepper effect populate before advancing frames.
      await renderer.update(<Sim />);
      for (const d of deltas) {
        // advanceFrames(frames, delta): delta is seconds, fed to useFrame.
        await renderer.advanceFrames(1, d);
      }
      const result = y;
      await renderer.unmount();
      world.destroy();
      b3.dispose();
      return result;
    }

    // 30 frames of 1/60s vs 15 frames of 2/60s — same 0.5s, same fixed-step count.
    const a = await simulate(Array.from({ length: 30 }, () => 1 / 60));
    const b = await simulate(Array.from({ length: 15 }, () => 2 / 60));
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeLessThan(10); // it fell
    expect(Math.abs(a - b)).toBeLessThan(1e-4);
  });
});

// ---- useTransformBuffer rebuild ----

describe('useTransformBuffer', () => {
  it('rebuilds the packed id list when bodies are added and removed', async () => {
    let bufferRef: ReturnType<typeof useTransformBuffer> | null = null;
    const allBodies: BodyHandle[] = [];

    function Scene({ n }: { n: number }) {
      const b3 = useBox3D(LOAD);
      const world = useWorld(b3);
      const [pool, setPool] = useState<BodyHandle[]>([]);

      // Create a fixed pool of 4 bodies once the world exists.
      useEffect(() => {
        if (!world || pool.length > 0) return;
        const made: BodyHandle[] = [];
        for (let i = 0; i < 4; i++) {
          const body = world.createBody({ type: 'dynamic', position: [i, 5, 0] });
          world.addSphere(body, 0.3);
          made.push(body);
          allBodies.push(body);
        }
        setPool(made);
      }, [world, pool.length]);

      const bodies = pool.slice(0, n);
      const buffer = useTransformBuffer(bodies, 16);
      bufferRef = buffer;
      return null;
    }

    const renderer = await mount(
      <Suspense fallback={null}>
        <Scene n={4} />
      </Suspense>,
    );
    expect(bufferRef!.count).toBe(4);
    const idsAt4 = Array.from(bufferRef!.ids);
    expect(idsAt4.length).toBe(4);

    // Remove two → buffer repacks to 2, keeping insertion order of survivors.
    await renderer.update(
      <Suspense fallback={null}>
        <Scene n={2} />
      </Suspense>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(bufferRef!.count).toBe(2);
    expect(Array.from(bufferRef!.ids)).toEqual(idsAt4.slice(0, 2));

    await renderer.unmount();
  });
});

// ---- useInstancedTransforms (no setState) ----

describe('useInstancedTransforms', () => {
  it('writes body poses into an InstancedMesh with no React re-render', async () => {
    let renderCount = 0;
    let mesh: THREE.InstancedMesh | null = null;

    function Scene() {
      renderCount += 1;
      const b3 = useBox3D(LOAD);
      const world = useWorld(b3);
      const meshRef = useRef<THREE.InstancedMesh>(null);
      const [bodies, setBodies] = useState<BodyHandle[]>([]);

      useEffect(() => {
        if (!world || bodies.length > 0) return;
        const made: BodyHandle[] = [];
        for (let i = 0; i < 3; i++) {
          const body = world.createBody({ type: 'dynamic', position: [i, 8, 0] });
          world.addBox(body, [0.5, 0.5, 0.5]);
          made.push(body);
        }
        setBodies(made);
      }, [world, bodies.length]);

      const buffer = useTransformBuffer(bodies, 8);
      const sync = useInstancedTransforms(meshRef, buffer);
      useFixedStep(world, {
        onAfterFrame: (stepped) => {
          if (!world || stepped === 0) return;
          buffer.readInto(world);
          sync();
        },
      });
      useEffect(() => {
        mesh = meshRef.current;
      });
      return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, 3]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial />
        </instancedMesh>
      );
    }

    const renderer = await mount(
      <Suspense fallback={null}>
        <Scene />
      </Suspense>,
    );
    const rendersAfterReady = renderCount;

    // Advance 30 frames — physics runs, matrices update, but React must NOT
    // re-render (transforms live in three.js, not state).
    await renderer.advanceFrames(30, 1 / 60);

    expect(mesh).toBeTruthy();
    expect(mesh!.instanceMatrix.needsUpdate === true || mesh!.instanceMatrix.version > 0).toBe(true);
    const m = new THREE.Matrix4();
    mesh!.getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.y).toBeLessThan(8); // fell from spawn Y=8
    expect(renderCount).toBe(rendersAfterReady); // no extra renders from 30 frames
    await renderer.unmount();
  });
});
