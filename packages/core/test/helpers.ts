import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createBox3D, type Box3D } from '../src/index.js';

const WASM_URL = new URL('../wasm/box3d.wasm', import.meta.url);

/** Read the shipped wasm bytes once, reuse across tests that want `wasmBinary`.
 *  Returns a Uint8Array over a plain ArrayBuffer (not a Node Buffer / SAB) so
 *  it satisfies BufferSource for WebAssembly.compile without a cast. */
export async function readWasmBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await readFile(fileURLToPath(WASM_URL));
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/** Create a fresh Box3D instance for a test (isolated WASM memory each time). */
export async function freshBox3D(): Promise<Box3D> {
  return createBox3D({ wasmUrl: WASM_URL });
}

/** A tiny falling-ball-over-ground scene, deterministic setup. Returns handles. */
export function buildDropScene(b3: Box3D) {
  const world = b3.createWorld({ gravity: [0, -9.81, 0] });
  const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
  world.addBox(ground, [50, 0.5, 50], { friction: 0.9, restitution: 0.0 });
  const ball = world.createBody({ type: 'dynamic', position: [0, 5, 0], ccd: true });
  world.addSphere(ball, 0.5, { density: 2, friction: 0.5, restitution: 0.3 });
  return { world, ground, ball };
}
