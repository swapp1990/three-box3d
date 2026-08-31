import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_NATIVE_GENERATION,
  MAX_NATIVE_SHAPE_INDEX,
  MAX_NATIVE_WORLDS,
  type BodyHandle,
  type Box3D,
  type ShapeHandle,
  type ShapeIdentity,
  type World,
} from '../src/index.js';
import { createEntityRegistry } from '../src/helpers/index.js';
import { freshBox3D } from './helpers.js';

interface Addr {
  readonly id: string;
  readonly world: string;
  readonly group?: string;
}

function registry(worldKey?: string) {
  return createEntityRegistry<Addr>({
    ...(worldKey === undefined ? {} : { worldKey }),
    addressKey: (a) => a.id,
    groupKey: (a) => a.group,
    addressWorldKey: (a) => a.world,
  });
}

const bh = (n: number) => n as BodyHandle;
const sh = (n: number) => n as ShapeHandle;

function ident(partial: Partial<ShapeIdentity> = {}): ShapeIdentity {
  return {
    index1: 1,
    world0: 0,
    generation: 1,
    ...partial,
  };
}

describe('createEntityRegistry — register / group / duplicate / affinity / limits', () => {
  it('registers, resolves, and unregisters bodies and shapes', () => {
    const reg = registry('w');
    const body = reg.registerBody(bh(7), { id: 'leaf-a', world: 'w', group: 'g' });
    expect(reg.resolveBody(bh(7))).toBe(body);
    expect(body.address.id).toBe('leaf-a');

    const shape = reg.registerShape(sh(3), bh(7), ident({ index1: 4, generation: 9 }));
    expect(reg.resolveShape(ident({ index1: 4, generation: 9 }))).toBe(shape);
    expect(shape.bodyRegistration).toBe(body);
    expect(reg.getStats()).toMatchObject({
      bodyCount: 1,
      shapeCount: 1,
      groupCount: 1,
      groupBodyCount: 1,
      ungroupedBodyCount: 0,
    });

    expect(reg.unregisterShape(ident({ index1: 4, generation: 9 }))).toBe(true);
    expect(reg.resolveShape(ident({ index1: 4, generation: 9 }))).toBeUndefined();
    expect(reg.resolveBody(bh(7))).toBe(body);
    expect(reg.unregisterShape(ident({ index1: 4, generation: 9 }))).toBe(false);

    expect(reg.unregisterBody(bh(7))).toBe(true);
    expect(reg.resolveBody(bh(7))).toBeUndefined();
    expect(reg.unregisterBody(bh(7))).toBe(false);
    expect(reg.getStats()).toMatchObject({
      bodyCount: 0,
      shapeCount: 0,
      groupCount: 0,
      groupBodyCount: 0,
      ungroupedBodyCount: 0,
    });
  });

  it('unregisterBody also drops that body\'s shapes', () => {
    const reg = registry('w');
    reg.registerBody(bh(1), { id: 'a', world: 'w' });
    reg.registerShape(sh(10), bh(1), ident({ index1: 1 }));
    reg.registerShape(sh(11), bh(1), ident({ index1: 2 }));
    expect(reg.unregisterBody(bh(1))).toBe(true);
    expect(reg.resolveShape(ident({ index1: 1 }))).toBeUndefined();
    expect(reg.resolveShape(ident({ index1: 2 }))).toBeUndefined();
    expect(reg.getStats().shapeCount).toBe(0);
  });

  it('isolates groups: unregisterGroup removes only that group', () => {
    const reg = registry('w');
    reg.registerBody(bh(1), { id: 'a', world: 'w', group: 'g1' });
    reg.registerBody(bh(2), { id: 'b', world: 'w', group: 'g1' });
    reg.registerBody(bh(3), { id: 'c', world: 'w', group: 'g2' });
    reg.registerBody(bh(4), { id: 'd', world: 'w' });
    reg.registerShape(sh(1), bh(1), ident({ index1: 1 }));
    reg.registerShape(sh(3), bh(3), ident({ index1: 3 }));

    expect(reg.getStats()).toEqual({
      bodyCount: 4,
      shapeCount: 2,
      groupCount: 2,
      groupBodyCount: 3,
      ungroupedBodyCount: 1,
    });

    expect(reg.unregisterGroup('g1')).toBe(2);
    expect(reg.resolveBody(bh(1))).toBeUndefined();
    expect(reg.resolveBody(bh(2))).toBeUndefined();
    expect(reg.resolveShape(ident({ index1: 1 }))).toBeUndefined();
    expect(reg.resolveBody(bh(3))?.address.id).toBe('c');
    expect(reg.resolveBody(bh(4))?.address.id).toBe('d');
    expect(reg.resolveShape(ident({ index1: 3 }))).toBeDefined();
    expect(reg.getStats()).toMatchObject({
      bodyCount: 2,
      shapeCount: 1,
      groupCount: 1,
      groupBodyCount: 1,
      ungroupedBodyCount: 1,
    });
    expect(reg.unregisterGroup('missing')).toBe(0);
  });

  it('rejects a duplicate body/address without removing the original', () => {
    const reg = registry('w');
    const first = reg.registerBody(bh(1), { id: 'a', world: 'w', group: 'g' });
    expect(() => reg.registerBody(bh(1), { id: 'other', world: 'w' })).toThrow(
      /body 1 is already registered/,
    );
    expect(reg.resolveBody(bh(1))).toBe(first);
    expect(first.address.id).toBe('a');

    const second = reg.registerBody(bh(2), { id: 'b', world: 'w' });
    expect(() => reg.registerBody(bh(3), { id: 'a', world: 'w' })).toThrow(
      /address a is already registered/,
    );
    expect(reg.resolveBody(bh(1))).toBe(first);
    expect(reg.resolveBody(bh(2))).toBe(second);
    expect(reg.resolveBody(bh(3))).toBeUndefined();
    expect(reg.getStats().bodyCount).toBe(2);
  });

  it('rejects a duplicate shape identity or handle without removing the original', () => {
    const reg = registry('w');
    const body = reg.registerBody(bh(1), { id: 'a', world: 'w' });
    const original = reg.registerShape(sh(10), bh(1), ident({ index1: 1, generation: 4 }));

    expect(() =>
      reg.registerShape(sh(11), bh(1), ident({ index1: 1, generation: 4 })),
    ).toThrow(/shape identity .* is already registered/);
    expect(reg.resolveShape(ident({ index1: 1, generation: 4 }))).toBe(original);
    expect(original.bodyRegistration).toBe(body);

    expect(() =>
      reg.registerShape(sh(10), bh(1), ident({ index1: 2, generation: 4 })),
    ).toThrow(/shape handle 10 is already registered/);
    expect(reg.resolveShape(ident({ index1: 1, generation: 4 }))).toBe(original);
    expect(reg.resolveShape(ident({ index1: 2, generation: 4 }))).toBeUndefined();
    expect(reg.getStats().shapeCount).toBe(1);
  });

  it('rejects an address from a different semantic world (constructed and latched)', () => {
    const pinned = registry('alpha');
    const first = pinned.registerBody(bh(1), { id: 'a', world: 'alpha' });
    expect(() => pinned.registerBody(bh(2), { id: 'b', world: 'beta' })).toThrow(
      /address belongs to a different physics world/,
    );
    expect(pinned.resolveBody(bh(1))).toBe(first);
    expect(pinned.resolveBody(bh(2))).toBeUndefined();

    pinned.clear();
    expect(pinned.getStats().bodyCount).toBe(0);
    expect(() => pinned.registerBody(bh(1), { id: 'a', world: 'beta' })).toThrow(
      /address belongs to a different physics world/,
    );

    const latched = registry();
    latched.registerBody(bh(1), { id: 'a', world: 'alpha' });
    expect(() => latched.registerBody(bh(2), { id: 'b', world: 'beta' })).toThrow(
      /address belongs to a different physics world/,
    );
    expect(latched.getStats().bodyCount).toBe(1);
  });

  it('rejects a shape identity from a different native world0', () => {
    const reg = registry('w');
    reg.registerBody(bh(1), { id: 'a', world: 'w' });
    const first = reg.registerShape(sh(1), bh(1), ident({ world0: 0, index1: 1 }));
    expect(() =>
      reg.registerShape(sh(2), bh(1), ident({ world0: 1, index1: 1 })),
    ).toThrow(/shape identity belongs to a different physics world/);
    expect(reg.resolveShape(ident({ world0: 0, index1: 1 }))).toBe(first);
    expect(reg.resolveShape(ident({ world0: 1, index1: 1 }))).toBeUndefined();
  });

  it('validates ShapeIdentity against canonical native limits', () => {
    const reg = registry('w');
    const body = reg.registerBody(bh(1), { id: 'a', world: 'w' });

    expect(() => reg.registerShape(sh(1), bh(1), ident({ index1: 0 }))).toThrow(
      RangeError,
    );
    expect(() =>
      reg.registerShape(sh(1), bh(1), ident({ index1: MAX_NATIVE_SHAPE_INDEX + 1 })),
    ).toThrow(`shapeIdentity.index1 must be in the native range 1..${MAX_NATIVE_SHAPE_INDEX}`);
    expect(() => reg.registerShape(sh(1), bh(1), ident({ world0: -1 }))).toThrow(
      RangeError,
    );
    expect(() =>
      reg.registerShape(sh(1), bh(1), ident({ world0: MAX_NATIVE_WORLDS })),
    ).toThrow(
      `shapeIdentity.world0 must be in the native world range 0..${MAX_NATIVE_WORLDS - 1}`,
    );
    expect(() => reg.registerShape(sh(1), bh(1), ident({ generation: -1 }))).toThrow(
      RangeError,
    );
    expect(() =>
      reg.registerShape(sh(1), bh(1), ident({ generation: MAX_NATIVE_GENERATION + 1 })),
    ).toThrow(
      `shapeIdentity.generation must be in the uint16 range 0..${MAX_NATIVE_GENERATION}`,
    );
    expect(() => reg.registerShape(sh(1), bh(1), ident({ index1: 1.5 }))).toThrow(
      RangeError,
    );

    expect(reg.resolveBody(bh(1))).toBe(body);
    expect(reg.getStats().shapeCount).toBe(0);

    const atLimit = reg.registerShape(
      sh(1),
      bh(1),
      ident({
        index1: MAX_NATIVE_SHAPE_INDEX,
        world0: 0,
        generation: MAX_NATIVE_GENERATION,
      }),
    );
    expect(atLimit.identity.index1).toBe(MAX_NATIVE_SHAPE_INDEX);
    expect(atLimit.identity.generation).toBe(MAX_NATIVE_GENERATION);
  });

  it('snapshots sorted frozen bodies/shapes and frozen stats', () => {
    const reg = registry('w');
    reg.registerBody(bh(10), { id: 'z', world: 'w', group: 'g' });
    reg.registerBody(bh(2), { id: 'a', world: 'w' });
    reg.registerShape(sh(8), bh(10), ident({ world0: 0, index1: 5, generation: 1 }));
    reg.registerShape(sh(3), bh(2), ident({ world0: 0, index1: 2, generation: 9 }));

    const snap = reg.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.stats)).toBe(true);
    expect(Object.isFrozen(snap.bodies)).toBe(true);
    expect(Object.isFrozen(snap.shapes)).toBe(true);
    expect(snap.bodies.map((b) => b.body)).toEqual([2, 10]);
    expect(snap.shapes.map((s) => s.identity.index1)).toEqual([2, 5]);
    expect(snap.stats).toEqual({
      bodyCount: 2,
      shapeCount: 2,
      groupCount: 1,
      groupBodyCount: 1,
      ungroupedBodyCount: 1,
    });
    expect(reg.getStats()).toEqual(snap.stats);
  });

  it('freezes registrations and copied identities/addresses', () => {
    const reg = registry('w');
    const addr = { id: 'a', world: 'w', group: 'g' };
    const rawIdentity = { index1: 3, world0: 0, generation: 2 };
    const body = reg.registerBody(bh(1), addr);
    const shape = reg.registerShape(sh(1), bh(1), rawIdentity);

    expect(Object.isFrozen(body)).toBe(true);
    expect(Object.isFrozen(body.address)).toBe(true);
    expect(Object.isFrozen(shape)).toBe(true);
    expect(Object.isFrozen(shape.identity)).toBe(true);

    addr.id = 'mutated';
    rawIdentity.index1 = 99;
    expect(body.address.id).toBe('a');
    expect(shape.identity.index1).toBe(3);
    expect(reg.resolveShape(ident({ index1: 3, generation: 2 }))).toBe(shape);

    expect(() => {
      (body as { body: BodyHandle }).body = bh(99);
    }).toThrow();
    expect(() => {
      (shape.identity as { index1: number }).index1 = 1;
    }).toThrow();
  });
});

describe('createEntityRegistry — real WASM identities', () => {
  let b3: Box3D;
  beforeEach(async () => {
    b3 = await freshBox3D();
  });
  afterEach(() => b3.dispose());

  function addShape(world: World) {
    const body = world.createBody({ type: 'static', position: [0, 0, 0] });
    const shape = world.addBox(body, [0.5, 0.5, 0.5]);
    const identity = world.getShapeIdentity(shape);
    expect(identity).not.toBeNull();
    return { body, shape, identity: identity! };
  }

  it('round-trips real shape identities through register / resolve / unregister', () => {
    const world = b3.createWorld();
    const { body, shape, identity } = addShape(world);
    const reg = registry('native');
    const bodyReg = reg.registerBody(body, { id: 'ground', world: 'native', group: 'g' });
    const shapeReg = reg.registerShape(shape, body, identity);

    expect(reg.resolveBody(body)).toBe(bodyReg);
    expect(reg.resolveShape(identity)).toBe(shapeReg);
    expect(shapeReg.identity).toEqual(identity);
    expect(shapeReg.body).toBe(body);

    expect(reg.unregisterShape(identity)).toBe(true);
    expect(reg.resolveShape(identity)).toBeUndefined();
    expect(reg.unregisterBody(body)).toBe(true);
    expect(reg.resolveBody(body)).toBeUndefined();
    world.destroy();
  });

  it('rejects a real shape identity from a second native world', () => {
    const worldA = b3.createWorld();
    const worldB = b3.createWorld();
    const a = addShape(worldA);
    const b = addShape(worldB);
    expect(a.identity.world0).not.toBe(b.identity.world0);

    const reg = registry('native');
    reg.registerBody(a.body, { id: 'a', world: 'native' });
    const first = reg.registerShape(a.shape, a.body, a.identity);
    reg.registerBody(b.body, { id: 'b', world: 'native' });
    expect(() => reg.registerShape(b.shape, b.body, b.identity)).toThrow(
      /shape identity belongs to a different physics world/,
    );
    expect(reg.resolveShape(a.identity)).toBe(first);
    expect(reg.resolveShape(b.identity)).toBeUndefined();
    worldA.destroy();
    worldB.destroy();
  });
});
