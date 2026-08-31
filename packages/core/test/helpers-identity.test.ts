import { describe, expect, it } from 'vitest';
import {
  createIdentitySystem,
  sameIdentity,
  type Identity,
} from '../src/helpers/index.js';

const DESTRUCTION_KINDS = [
  'world',
  'structure',
  'element',
  'layer',
  'cell',
  'fragment',
] as const;

type DestructionKind = (typeof DESTRUCTION_KINDS)[number];

function destructionSystem() {
  return createIdentitySystem({
    kinds: DESTRUCTION_KINDS,
    parentOf: {
      world: null,
      structure: 'world',
      element: 'structure',
      layer: 'element',
      cell: 'layer',
      fragment: ['cell', 'layer'] as const,
    },
  });
}

function mintAppGraph(
  mint: <K extends DestructionKind>(
    kind: K,
    ordinal: number,
    parent?: Identity<DestructionKind>,
  ) => Identity<DestructionKind, K>,
  ordinal = 0,
) {
  const world = mint('world', ordinal);
  const structure = mint('structure', ordinal, world);
  const element = mint('element', ordinal, structure);
  const layer = mint('layer', ordinal, element);
  const cell = mint('cell', ordinal, layer);
  const fragmentFromCell = mint('fragment', ordinal, cell);
  const fragmentFromLayer = mint('fragment', ordinal + 1, layer);
  return { world, structure, element, layer, cell, fragmentFromCell, fragmentFromLayer };
}

describe('createIdentitySystem — app hierarchy key format', () => {
  it('mints the exact world→structure→element→layer→cell (+ fragment) keys', () => {
    const { mint } = destructionSystem().forScope({ namespace: 'yard', generation: 0 });
    const graph = mintAppGraph(mint);

    expect(graph.world.key).toBe('world:yard:g0:n0');
    expect(graph.structure.key).toBe('structure:yard:g0:n0/world:yard:g0:n0');
    expect(graph.element.key).toBe(
      'element:yard:g0:n0/structure:yard:g0:n0/world:yard:g0:n0',
    );
    expect(graph.layer.key).toBe(
      'layer:yard:g0:n0/element:yard:g0:n0/structure:yard:g0:n0/world:yard:g0:n0',
    );
    expect(graph.cell.key).toBe(
      'cell:yard:g0:n0/layer:yard:g0:n0/element:yard:g0:n0/structure:yard:g0:n0/world:yard:g0:n0',
    );
    expect(graph.fragmentFromCell.key).toBe(`fragment:yard:g0:n0/${graph.cell.key}`);
    expect(graph.fragmentFromLayer.key).toBe(`fragment:yard:g0:n1/${graph.layer.key}`);
  });

  it('encodeURIComponent-encodes the namespace and leaves kind unencoded', () => {
    const { mint } = destructionSystem().forScope({
      namespace: 'yard/ns a',
      generation: 2,
    });
    const world = mint('world', 4);
    expect(world.key).toBe(`world:${encodeURIComponent('yard/ns a')}:g2:n4`);
    expect(world.key).toBe('world:yard%2Fns%20a:g2:n4');
  });
});

describe('createIdentitySystem — determinism', () => {
  it('replays the same scope/generation/ordinals to byte-equal keys', () => {
    const system = destructionSystem();
    const a = mintAppGraph(system.forScope({ namespace: 'yard', generation: 7 }).mint);
    const b = mintAppGraph(system.forScope({ namespace: 'yard', generation: 7 }).mint);

    expect(a.world.key).toBe(b.world.key);
    expect(a.cell.key).toBe(b.cell.key);
    expect(a.fragmentFromCell.key).toBe(b.fragmentFromCell.key);
    expect(a.fragmentFromLayer.key).toBe(b.fragmentFromLayer.key);
    expect(a.world).not.toBe(b.world);
    expect(sameIdentity(a.cell, b.cell)).toBe(true);
    expect(system.sameIdentity(a.structure, b.structure)).toBe(true);
  });

  it('gives a recycled scope a different generation key', () => {
    const system = destructionSystem();
    const gen0 = system.forScope({ namespace: 'yard', generation: 0 }).mint('world', 0);
    const gen1 = system.forScope({ namespace: 'yard', generation: 1 }).mint('world', 0);
    expect(gen0.key).toBe('world:yard:g0:n0');
    expect(gen1.key).toBe('world:yard:g1:n0');
    expect(sameIdentity(gen0, gen1)).toBe(false);
  });
});

describe('createIdentitySystem — frozen object shape', () => {
  it('freezes identities and omits parent on roots', () => {
    const { mint, scope } = destructionSystem().forScope({
      namespace: 'yard',
      generation: 0,
    });
    expect(Object.isFrozen(scope)).toBe(true);
    const world = mint('world', 0);
    const structure = mint('structure', 1, world);

    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.isFrozen(structure)).toBe(true);
    expect(world).toEqual({
      kind: 'world',
      namespace: 'yard',
      generation: 0,
      ordinal: 0,
      key: 'world:yard:g0:n0',
    });
    expect('parent' in world).toBe(false);
    expect(structure.parent).toBe(world);
    expect(Object.keys(world)).toEqual(['kind', 'namespace', 'generation', 'ordinal', 'key']);
    expect(Object.keys(structure)).toEqual([
      'kind',
      'namespace',
      'generation',
      'ordinal',
      'key',
      'parent',
    ]);
    expect(() => {
      (world as { ordinal: number }).ordinal = 99;
    }).toThrow();
  });
});

describe('createIdentitySystem — validation', () => {
  it('rejects empty / whitespace namespaces', () => {
    const system = destructionSystem();
    expect(() => system.forScope({ namespace: '', generation: 0 })).toThrow(TypeError);
    expect(() => system.forScope({ namespace: '', generation: 0 })).toThrow(
      'identity namespace must be a non-empty string',
    );
    expect(() => system.forScope({ namespace: '   ', generation: 0 })).toThrow(TypeError);
  });

  it('rejects non-negative-safe-integer generation and ordinal', () => {
    const system = destructionSystem();
    expect(() => system.forScope({ namespace: 'yard', generation: -1 })).toThrow(RangeError);
    expect(() => system.forScope({ namespace: 'yard', generation: -1 })).toThrow(
      'identity generation must be a non-negative safe integer',
    );
    expect(() => system.forScope({ namespace: 'yard', generation: 1.5 })).toThrow(RangeError);
    expect(() => system.forScope({ namespace: 'yard', generation: Number.NaN })).toThrow(
      RangeError,
    );

    const { mint } = system.forScope({ namespace: 'yard', generation: 0 });
    expect(() => mint('world', -1)).toThrow(RangeError);
    expect(() => mint('world', -1)).toThrow(
      'identity ordinal must be a non-negative safe integer',
    );
    expect(() => mint('world', 1.2)).toThrow(RangeError);
    expect(() => mint('world', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a parent from another namespace or generation', () => {
    const system = destructionSystem();
    const foreignNs = system.forScope({ namespace: 'other', generation: 0 }).mint('world', 0);
    const foreignGen = system.forScope({ namespace: 'yard', generation: 1 }).mint('world', 0);
    const { mint } = system.forScope({ namespace: 'yard', generation: 0 });

    expect(() => mint('structure', 0, foreignNs)).toThrow(
      'identity parent must share namespace and generation',
    );
    expect(() => mint('structure', 0, foreignGen)).toThrow(
      'identity parent must share namespace and generation',
    );
  });

  it('enforces parent kinds, including fragment(cell|layer)', () => {
    const { mint } = destructionSystem().forScope({ namespace: 'yard', generation: 0 });
    const world = mint('world', 0);
    const structure = mint('structure', 0, world);
    const element = mint('element', 0, structure);
    const layer = mint('layer', 0, element);
    const cell = mint('cell', 0, layer);

    expect(() => mint('world', 1, world)).toThrow('world identity cannot have a parent');
    expect(() => mint('structure', 1)).toThrow('structure identity requires a world parent');
    expect(() => mint('structure', 1, structure)).toThrow(
      'structure identity requires a world parent',
    );
    expect(() => mint('cell', 1, element)).toThrow('cell identity requires a layer parent');
    expect(() => mint('fragment', 0)).toThrow(
      'fragment identity requires a cell or layer parent',
    );
    expect(() => mint('fragment', 0, world)).toThrow(
      'fragment identity requires a cell or layer parent',
    );
    expect(mint('fragment', 0, cell).parent).toBe(cell);
    expect(mint('fragment', 1, layer).parent).toBe(layer);
  });

  it('rejects an unregistered kind', () => {
    const { mint } = destructionSystem().forScope({ namespace: 'yard', generation: 0 });
    expect(() => mint('nope' as DestructionKind, 0)).toThrow(
      'nope is not a registered identity kind',
    );
  });
});

describe('sameIdentity', () => {
  it('compares by key and treats undefined as not equal', () => {
    const { mint } = destructionSystem().forScope({ namespace: 'yard', generation: 0 });
    const a = mint('world', 0);
    const b = mint('world', 0);
    const c = mint('world', 1);
    expect(sameIdentity(a, b)).toBe(true);
    expect(sameIdentity(a, c)).toBe(false);
    expect(sameIdentity(a, undefined)).toBe(false);
    expect(sameIdentity(undefined, b)).toBe(false);
    expect(sameIdentity(undefined, undefined)).toBe(false);
  });
});

describe('createIdentitySystem — caller-supplied kinds', () => {
  it('genericizes over a non-destruction hierarchy', () => {
    const system = createIdentitySystem({
      kinds: ['root', 'node'] as const,
      parentOf: { root: null, node: 'root' },
    });
    const { mint } = system.forScope({ namespace: 'tree', generation: 3 });
    const root = mint('root', 0);
    const node = mint('node', 8, root);
    expect(root.key).toBe('root:tree:g3:n0');
    expect(node.key).toBe('node:tree:g3:n8/root:tree:g3:n0');
    expect(() => mint('node', 0, node)).toThrow('node identity requires a root parent');
  });
});
