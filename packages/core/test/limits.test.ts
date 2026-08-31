import { describe, expect, it } from 'vitest';
import {
  MAX_NATIVE_GENERATION,
  MAX_NATIVE_SHAPE_INDEX,
  MAX_NATIVE_WORLDS,
} from '../src/index.js';

describe('native-limit constants', () => {
  it('matches the boxed engine/bridge defaults', () => {
    expect(MAX_NATIVE_SHAPE_INDEX).toBe(1 << 22);
    expect(MAX_NATIVE_SHAPE_INDEX).toBe(4_194_304);
    expect(MAX_NATIVE_WORLDS).toBe(128);
    expect(MAX_NATIVE_GENERATION).toBe(0xffff);
    expect(MAX_NATIVE_GENERATION).toBe(65_535);
  });

  it('fits ShapeIdentity.generation in a native uint16', () => {
    expect(Number.isInteger(MAX_NATIVE_GENERATION)).toBe(true);
    expect(MAX_NATIVE_GENERATION).toBeGreaterThanOrEqual(0);
    expect(MAX_NATIVE_GENERATION).toBeLessThanOrEqual(0xffff);
    expect(MAX_NATIVE_GENERATION).toBe(MAX_NATIVE_GENERATION & 0xffff);
    expect(MAX_NATIVE_GENERATION).toBeLessThan(1 << 16);
  });
});
