/**
 * radialImpulse — the explode workaround. Native `b3World_Explode` is a NO-OP on
 * sleeping bodies, so this wakes each in-range body and applies a falloff impulse
 * with optional upward bias. Reads poses from a TransformBuffer (no per-body
 * query). Framework-agnostic (no three import).
 *
 * Exact math (frozen — see docs/api-design.md §2.11), per body at distance
 * d ≤ radius from center:
 *   f        = 1 - d/radius                        // falloff factor, 0..1
 *   s        = strength * f²                       // 'quadratic' (default); 'linear' uses s = strength * f
 *   impulse  = normalize(bodyPos - center) * s     // radial direction (zero vector if d < 1mm)
 *   impulse.y += upwardBias * s                    // upward bias, fraction of the local strength
 *   wakeBody(body); applyImpulse(body, impulse, bodyPos)
 *
 * Reproduces both dogfood tunings exactly: yardPhysics boomAt
 * (strength 0.9, upwardBias 0.28) and playgroundPhysics blastAt
 * (strength 8.5, upwardBias 1.1).
 */
import type { BodyHandle, Vec3 } from '../types.js';

interface WorldLike {
  wakeBody(body: BodyHandle): void;
  applyImpulse(body: BodyHandle, impulse: Vec3, at?: Vec3): void;
}

interface BufferLike {
  offsetOf(body: BodyHandle): number | undefined;
  readonly transforms: Float32Array;
}

export interface RadialImpulseOptions {
  center: Vec3;
  radius: number;
  strength: number; // peak impulse magnitude at center
  falloff?: 'linear' | 'quadratic'; // default 'quadratic'
  upwardBias?: number; // fraction of local strength added on +Y, default 0
}

// Module-scoped scratch so the hot path allocates nothing.
const impulseScratch: [number, number, number] = [0, 0, 0];
const atScratch: [number, number, number] = [0, 0, 0];

export function radialImpulse(
  world: WorldLike,
  bodies: readonly BodyHandle[],
  buffer: BufferLike,
  options: RadialImpulseOptions,
): void {
  const { center, radius, strength } = options;
  if (!(radius > 0)) return;
  const quadratic = (options.falloff ?? 'quadratic') === 'quadratic';
  const upwardBias = options.upwardBias ?? 0;
  const cx = center[0];
  const cy = center[1];
  const cz = center[2];
  const transforms = buffer.transforms;

  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const offset = buffer.offsetOf(body);
    if (offset === undefined) continue;
    const bx = transforms[offset];
    const by = transforms[offset + 1];
    const bz = transforms[offset + 2];
    const dx = bx - cx;
    const dy = by - cy;
    const dz = bz - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;

    const f = 1 - d / radius;
    const s = quadratic ? strength * f * f : strength * f;
    const inv = d > 0.001 ? 1 / d : 0; // zero direction if within 1mm of center
    impulseScratch[0] = dx * inv * s;
    impulseScratch[1] = dy * inv * s + upwardBias * s;
    impulseScratch[2] = dz * inv * s;
    atScratch[0] = bx;
    atScratch[1] = by;
    atScratch[2] = bz;

    world.wakeBody(body);
    world.applyImpulse(body, impulseScratch as unknown as Vec3, atScratch as unknown as Vec3);
  }
}
