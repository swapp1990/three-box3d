import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BodyHandle, Box3D, ShapeHandle, ShapeIdentity, World } from '../src/index.js';
import {
  createEntityRegistry,
  createRegistrationHost,
  EntityRegistry,
  spawnRegistered,
  type SpawnWorld,
} from '../src/helpers/index.js';
import { freshBox3D } from './helpers.js';

interface Addr {
  readonly id: string;
  readonly world: string;
  readonly group?: string;
}

function registry(worldKey = 'w') {
  return createEntityRegistry<Addr>({
    worldKey,
    addressKey: (a) => a.id,
    groupKey: (a) => a.group,
    addressWorldKey: (a) => a.world,
  });
}

class PrimedRegistry extends EntityRegistry<Addr> {
  rejectBody = false;
  rejectShape = false;

  override registerBody(body: BodyHandle, address: Addr) {
    if (this.rejectBody) throw new Error('registry primed to reject body');
    return super.registerBody(body, address);
  }

  override registerShape(shape: ShapeHandle, body: BodyHandle, identity: ShapeIdentity) {
    if (this.rejectShape) throw new Error('registry primed to reject shape');
    return super.registerShape(shape, body, identity);
  }
}

function primedRegistry(): PrimedRegistry {
  return new PrimedRegistry({
    worldKey: 'w',
    addressKey: (a: Addr) => a.id,
    groupKey: (a: Addr) => a.group,
    addressWorldKey: (a: Addr) => a.world,
  });
}

function nativeCensus(world: World) {
  return {
    bodies: world.bodyCount(),
    shapes: world.overlapAABB([-1e3, -1e3, -1e3], [1e3, 1e3, 1e3]).length,
  };
}

function wrapWorld(world: World, overrides: Partial<SpawnWorld>): SpawnWorld {
  return {
    createBody: (options) => world.createBody(options),
    destroyBody: (body) => world.destroyBody(body),
    addBox: (body, half, material) => world.addBox(body, half, material),
    addSphere: (body, radius, material) => world.addSphere(body, radius, material),
    addCapsule: (body, radius, halfHeight, material) =>
      world.addCapsule(body, radius, halfHeight, material),
    addSensorBox: (body, half) => world.addSensorBox(body, half),
    addHull: (body, points, options) => world.addHull(body, points, options),
    getShapeIdentity: (shape) => world.getShapeIdentity(shape),
    ...overrides,
  };
}

function seedKeeper(world: World, reg: EntityRegistry<Addr>, id = 'keeper') {
  const spawned = spawnRegistered(world, reg, {
    body: { type: 'static', position: [8, 0, 0] },
    bodyAddress: { id, world: 'w', group: 'keep' },
    shapes: [{ kind: 'box', half: [0.4, 0.4, 0.4] }],
  });
  return spawned;
}

describe('spawnRegistered / createRegistrationHost — real WASM', () => {
  let b3: Box3D;
  let world: World;

  beforeEach(async () => {
    b3 = await freshBox3D();
    world = b3.createWorld({ gravity: [0, 0, 0], enableSleep: false });
  });

  afterEach(() => {
    b3.dispose();
  });

  it('spawns a body with multiple shapes and registers them', () => {
    const reg = registry();
    const spawned = spawnRegistered(world, reg, {
      body: { type: 'dynamic', position: [0, 1, 0] },
      bodyAddress: { id: 'actor', world: 'w', group: 'g' },
      shapes: [
        { kind: 'box', half: [0.5, 0.25, 0.5], material: { density: 2 } },
        { kind: 'sphere', radius: 0.2, material: { friction: 0.4 } },
      ],
    });

    expect(world.bodyCount()).toBe(1);
    expect(spawned.shapes).toHaveLength(2);
    expect(spawned.bodyRegistration.address.id).toBe('actor');
    expect(reg.resolveBody(spawned.body)).toBe(spawned.bodyRegistration);
    expect(reg.resolveShape(spawned.shapes[0]!.identity)).toBe(
      spawned.shapes[0]!.registration,
    );
    expect(reg.resolveShape(spawned.shapes[1]!.identity)).toBe(
      spawned.shapes[1]!.registration,
    );
    expect(world.getShapeIdentity(spawned.shapes[0]!.shape)).toEqual(
      spawned.shapes[0]!.identity,
    );
    expect(world.getShapeIdentity(spawned.shapes[1]!.shape)).toEqual(
      spawned.shapes[1]!.identity,
    );
    expect(Object.isFrozen(spawned)).toBe(true);
    expect(Object.isFrozen(spawned.shapes)).toBe(true);
    expect(Object.isFrozen(spawned.shapes[0]!)).toBe(true);
    expect(Object.isFrozen(spawned.shapes[0]!.identity)).toBe(true);
    expect(nativeCensus(world).shapes).toBe(2);
  });

  it('rolls back native body/shape counts when the registry is primed to reject a body', () => {
    const reg = primedRegistry();
    const keeper = seedKeeper(world, reg);
    const baseline = nativeCensus(world);
    const prior = reg.resolveBody(keeper.body);
    const priorShape = reg.resolveShape(keeper.shapes[0]!.identity);

    reg.rejectBody = true;
    expect(() =>
      spawnRegistered(world, reg, {
        body: { type: 'dynamic', position: [0, 2, 0] },
        bodyAddress: { id: 'fail-body', world: 'w' },
        shapes: [{ kind: 'box', half: [0.5, 0.5, 0.5] }],
      }),
    ).toThrow(/registry primed to reject body/);

    expect(nativeCensus(world)).toEqual(baseline);
    expect(reg.resolveBody(keeper.body)).toBe(prior);
    expect(reg.resolveShape(keeper.shapes[0]!.identity)).toBe(priorShape);
    expect(reg.getStats()).toMatchObject({ bodyCount: 1, shapeCount: 1 });
    expect(world.getShapeIdentity(keeper.shapes[0]!.shape)).toEqual(
      keeper.shapes[0]!.identity,
    );
  });

  it('rolls back native body/shape counts when the registry is primed to reject a shape', () => {
    const reg = primedRegistry();
    const keeper = seedKeeper(world, reg);
    const baseline = nativeCensus(world);
    const prior = reg.resolveBody(keeper.body);

    reg.rejectShape = true;
    expect(() =>
      spawnRegistered(world, reg, {
        body: { type: 'dynamic', position: [0, 2, 0] },
        bodyAddress: { id: 'fail-shape', world: 'w' },
        shapes: [{ kind: 'sphere', radius: 0.3 }],
      }),
    ).toThrow(/registry primed to reject shape/);

    expect(nativeCensus(world)).toEqual(baseline);
    expect(reg.resolveBody(keeper.body)).toBe(prior);
    expect(reg.resolveBody(keeper.body)?.address.id).toBe('keeper');
    expect(reg.getStats()).toMatchObject({ bodyCount: 1, shapeCount: 1 });
  });

  it('rolls back native body/shape counts when a shape-add is forced to fail', () => {
    const reg = registry();
    const keeper = seedKeeper(world, reg);
    const baseline = nativeCensus(world);
    const prior = reg.resolveBody(keeper.body);

    const failing = wrapWorld(world, {
      addBox() {
        throw new Error('forced shape-add failure');
      },
    });

    expect(() =>
      spawnRegistered(failing, reg, {
        body: { type: 'dynamic', position: [0, 2, 0] },
        bodyAddress: { id: 'fail-add', world: 'w' },
        shapes: [{ kind: 'box', half: [0.5, 0.5, 0.5] }],
      }),
    ).toThrow(/forced shape-add failure/);

    expect(nativeCensus(world)).toEqual(baseline);
    expect(reg.resolveBody(keeper.body)).toBe(prior);
    expect(reg.getStats()).toMatchObject({ bodyCount: 1, shapeCount: 1 });
  });

  it('rolls back the first native shape when a later shape-add fails', () => {
    const reg = registry();
    const keeper = seedKeeper(world, reg);
    const baseline = nativeCensus(world);

    const failing = wrapWorld(world, {
      addSphere() {
        throw new Error('forced second shape-add failure');
      },
    });

    expect(() =>
      spawnRegistered(failing, reg, {
        body: { type: 'dynamic', position: [0, 2, 0] },
        bodyAddress: { id: 'fail-second', world: 'w' },
        shapes: [
          { kind: 'box', half: [0.5, 0.5, 0.5] },
          { kind: 'sphere', radius: 0.2 },
        ],
      }),
    ).toThrow(/forced second shape-add failure/);

    expect(nativeCensus(world)).toEqual(baseline);
    expect(reg.resolveBody(keeper.body)?.address.id).toBe('keeper');
    expect(reg.getStats()).toMatchObject({ bodyCount: 1, shapeCount: 1 });
  });

  it('does not remove a pre-existing address registration when spawn is rejected', () => {
    const reg = registry();
    const keeper = seedKeeper(world, reg);
    const baseline = nativeCensus(world);

    expect(() =>
      spawnRegistered(world, reg, {
        body: { type: 'dynamic', position: [0, 2, 0] },
        bodyAddress: { id: 'keeper', world: 'w' },
        shapes: [{ kind: 'box', half: [0.25, 0.25, 0.25] }],
      }),
    ).toThrow(/address keeper is already registered/);

    expect(nativeCensus(world)).toEqual(baseline);
    expect(reg.resolveBody(keeper.body)?.address.id).toBe('keeper');
    expect(reg.getStats().bodyCount).toBe(1);
  });

  it('registers externally created bodies/shapes through a host', () => {
    const reg = registry();
    const host = createRegistrationHost({
      world,
      registry: reg,
      participantKey: 'group-a',
      belongsToHost: (address) => address.group === 'group-a',
    });

    const body = world.createBody({ type: 'static', position: [1, 0, 0] });
    const shape = world.addBox(body, [0.5, 0.5, 0.5]);
    const identity = world.getShapeIdentity(shape);
    expect(identity).not.toBeNull();

    const bodyReg = host.registerBody(body, { id: 'ext', world: 'w', group: 'group-a' });
    const shapeReg = host.registerShape(shape, body);

    expect(bodyReg.address.id).toBe('ext');
    expect(shapeReg.identity).toEqual(identity);
    expect(reg.resolveBody(body)).toBe(bodyReg);
    expect(reg.resolveShape(identity!)).toBe(shapeReg);
    expect(host.advanceRevision()).toBe(1);
    const snap = host.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toMatchObject({
      participantKey: 'group-a',
      revision: 1,
      disposed: false,
    });
    expect(snap.bodies).toEqual([body]);
    expect(snap.shapes).toEqual([identity]);
  });

  it('unregisters the body on registerShape failure so the outer owner destroys once', () => {
    const reg = registry();
    const body = world.createBody({ type: 'dynamic', position: [0, 1, 0] });
    const shape = world.addBox(body, [0.5, 0.5, 0.5]);
    const baselineBodies = world.bodyCount();

    const host = createRegistrationHost({
      world: {
        destroyBody: (b) => world.destroyBody(b),
        getShapeIdentity: () => null,
      },
      registry: reg,
      participantKey: 'group-a',
    });
    host.registerBody(body, { id: 'partial', world: 'w', group: 'group-a' });
    expect(reg.resolveBody(body)).toBeDefined();

    expect(() => host.registerShape(shape, body)).toThrow(
      /Box3D returned no shape identity/,
    );
    expect(reg.resolveBody(body)).toBeUndefined();
    expect(host.snapshot().bodies).toEqual([]);
    expect(world.bodyCount()).toBe(baselineBodies);
    expect(world.getShapeIdentity(shape)).not.toBeNull();

    world.destroyBody(body);
    expect(world.bodyCount()).toBe(0);
  });

  it('never removes a pre-existing valid registration on a duplicate-handle error', () => {
    const reg = registry();
    const body = world.createBody({ type: 'static', position: [0, 0, 0] });
    const original = reg.registerBody(body, { id: 'keep', world: 'w', group: 'g' });
    const host = createRegistrationHost({
      world,
      registry: reg,
      participantKey: 'group-a',
    });

    expect(() =>
      host.registerBody(body, { id: 'other', world: 'w', group: 'g' }),
    ).toThrow(/body .* is already registered/);
    expect(reg.resolveBody(body)).toBe(original);
    expect(original.address.id).toBe('keep');
    expect(host.snapshot().bodies).toEqual([]);
    expect(reg.getStats().bodyCount).toBe(1);

    const owned = world.createBody({ type: 'static', position: [1, 0, 0] });
    const ownedReg = host.registerBody(owned, { id: 'owned', world: 'w' });
    expect(() =>
      host.registerBody(owned, { id: 'owned-again', world: 'w' }),
    ).toThrow(/body .* is already registered/);
    expect(reg.resolveBody(owned)).toBe(ownedReg);
    expect(ownedReg.address.id).toBe('owned');
    expect(host.snapshot().bodies).toEqual([owned]);
    expect(reg.resolveBody(body)).toBe(original);
  });

  it('dispose destroys hosted natives and restores the census', () => {
    const reg = registry();
    const keeper = seedKeeper(world, reg);
    const host = createRegistrationHost({
      world,
      registry: reg,
      participantKey: 'group-a',
    });
    const body = world.createBody({ type: 'dynamic', position: [0, 2, 0] });
    const shape = world.addBox(body, [0.3, 0.3, 0.3]);
    host.registerBody(body, { id: 'hosted', world: 'w', group: 'g' });
    host.registerShape(shape, body);
    expect(world.bodyCount()).toBe(2);

    host.dispose();
    expect(nativeCensus(world)).toEqual({
      bodies: 1,
      shapes: 1,
    });
    expect(reg.resolveBody(body)).toBeUndefined();
    expect(reg.resolveBody(keeper.body)?.address.id).toBe('keeper');
    expect(() => host.registerBody(body, { id: 'after', world: 'w' })).toThrow(
      /used after dispose/,
    );
    expect(() => host.dispose()).not.toThrow();
  });

  it('rejects an address that does not belong to the host without mutating the registry', () => {
    const reg = registry();
    const host = createRegistrationHost({
      world,
      registry: reg,
      participantKey: 'group-a',
      belongsToHost: (address) => address.group === 'group-a',
    });
    const body = world.createBody({ type: 'static' });
    expect(() =>
      host.registerBody(body, { id: 'x', world: 'w', group: 'other' }),
    ).toThrow(/does not belong to this host/);
    expect(reg.resolveBody(body)).toBeUndefined();
    expect(host.snapshot().bodies).toEqual([]);
    world.destroyBody(body);
  });
});

describe('spawnRegistered / createRegistrationHost — argument checks', () => {
  it('rejects malformed spawn options without touching a fake world', () => {
    const reg = registry();
    const created: number[] = [];
    const destroyed: number[] = [];
    const fake: SpawnWorld = {
      createBody() {
        created.push(1);
        return 1 as BodyHandle;
      },
      destroyBody(body) {
        destroyed.push(body as number);
      },
      addBox() {
        return 2 as ShapeHandle;
      },
      addSphere() {
        return 3 as ShapeHandle;
      },
      addCapsule() {
        return 4 as ShapeHandle;
      },
      addSensorBox() {
        return 5 as ShapeHandle;
      },
      addHull() {
        return 6 as ShapeHandle;
      },
      getShapeIdentity() {
        return { index1: 1, world0: 0, generation: 1 };
      },
    };

    expect(() =>
      spawnRegistered(fake, reg, {
        bodyAddress: { id: 'a', world: 'w' },
        shapes: [{ kind: 'nope' } as never],
      }),
    ).toThrow(/unsupported shape kind nope/);
    expect(created).toEqual([1]);
    expect(destroyed).toEqual([1]);
    expect(reg.getStats().bodyCount).toBe(0);

    expect(() =>
      spawnRegistered(null as never, reg, {
        bodyAddress: { id: 'a', world: 'w' },
        shapes: [],
      }),
    ).toThrow(/requires a world/);
  });

  it('rejects malformed host options', () => {
    expect(() => createRegistrationHost(null as never)).toThrow(
      /registration host options must be an object/,
    );
    expect(() =>
      createRegistrationHost({
        world: { destroyBody() {}, getShapeIdentity: () => null },
        registry: registry(),
        participantKey: '',
      }),
    ).toThrow(/participantKey must be a non-empty string/);
  });
});
