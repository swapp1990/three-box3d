/**
 * Generic deterministic identity system.
 *
 * Identity allocation is deliberately caller-owned: an ordinal is part of the
 * input, rather than being obtained from a module-global counter. Replaying the
 * same scope, generation, and ordinals therefore produces byte-for-byte equal
 * keys, while a recycled scope gets a different generation key.
 *
 * The kind hierarchy is supplied by the caller (`kinds` + `parentOf`). Roots
 * map to `null` (no parent allowed); every other kind maps to one parent kind
 * or a list of acceptable parent kinds.
 */

declare const identityBrand: unique symbol;

export type Identity<TKind extends string = string, K extends TKind = TKind> = Readonly<{
  readonly kind: K;
  readonly namespace: string;
  readonly generation: number;
  readonly ordinal: number;
  readonly key: string;
  readonly parent?: Identity<TKind>;
}> & { readonly [identityBrand]: K };

export interface IdentityScope {
  readonly namespace: string;
  readonly generation: number;
}

export type IdentityParentOf<TKind extends string> = {
  readonly [K in TKind]: TKind | readonly TKind[] | null;
};

export interface IdentityMintScope<TKind extends string> {
  readonly scope: IdentityScope;
  mint<K extends TKind>(kind: K, ordinal: number, parent?: Identity<TKind>): Identity<TKind, K>;
}

export interface IdentitySystem<TKind extends string> {
  forScope(scope: IdentityScope): IdentityMintScope<TKind>;
  sameIdentity(
    a: Identity<TKind> | undefined,
    b: Identity<TKind> | undefined,
  ): boolean;
}

function checkedNamespace(namespace: string): string {
  if (typeof namespace !== 'string' || namespace.trim().length === 0) {
    throw new TypeError('identity namespace must be a non-empty string');
  }
  return namespace;
}

function checkedGeneration(generation: number): number {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError('identity generation must be a non-negative safe integer');
  }
  return generation;
}

function checkedOrdinal(ordinal: number): number {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RangeError('identity ordinal must be a non-negative safe integer');
  }
  return ordinal;
}

function acceptedParentKinds<TKind extends string>(
  spec: TKind | readonly TKind[] | null,
): readonly TKind[] | null {
  if (spec === null) return null;
  // `typeof` not `Array.isArray`: TKind extends string, and `Array.isArray`
  // does not narrow `readonly TKind[]` (its predicate is mutable `any[]`).
  if (typeof spec === 'string') return [spec];
  return spec;
}

function parentRequirementMessage(kind: string, accepted: readonly string[]): string {
  if (accepted.length === 1) {
    return `${kind} identity requires a ${accepted[0]} parent`;
  }
  if (accepted.length === 2) {
    return `${kind} identity requires a ${accepted[0]} or ${accepted[1]} parent`;
  }
  const head = accepted.slice(0, -1).join(', ');
  const last = accepted[accepted.length - 1] ?? '';
  return `${kind} identity requires a ${head}, or ${last} parent`;
}

/**
 * True when both identities exist and their keys are byte-equal.
 * `undefined` on either side is not equal (including `sameIdentity(undefined, undefined)`).
 */
export function sameIdentity<TKind extends string>(
  a: Identity<TKind> | undefined,
  b: Identity<TKind> | undefined,
): boolean {
  return a !== undefined && b !== undefined && a.key === b.key;
}

export function createIdentitySystem<TKind extends string>(config: {
  kinds: readonly TKind[];
  parentOf: IdentityParentOf<TKind>;
}): IdentitySystem<TKind> {
  const kindSet = new Set<string>(config.kinds);
  const parentOf = config.parentOf;

  function mintIdentity<K extends TKind>(
    kind: K,
    namespace: string,
    generation: number,
    ordinal: number,
    parent: Identity<TKind> | undefined,
  ): Identity<TKind, K> {
    const checked = checkedOrdinal(ordinal);
    if (!kindSet.has(kind)) {
      throw new Error(`${kind} is not a registered identity kind`);
    }
    if (parent && (parent.namespace !== namespace || parent.generation !== generation)) {
      throw new Error('identity parent must share namespace and generation');
    }
    const spec = parentOf[kind];
    const accepted = acceptedParentKinds(spec);
    if (accepted === null) {
      if (parent) throw new Error(`${kind} identity cannot have a parent`);
    } else if (!parent || !accepted.includes(parent.kind as TKind)) {
      throw new Error(parentRequirementMessage(kind, accepted));
    }
    const parentSuffix = parent ? `/${parent.key}` : '';
    const encodedNamespace = encodeURIComponent(namespace);
    return Object.freeze({
      kind,
      namespace,
      generation,
      ordinal: checked,
      key: `${kind}:${encodedNamespace}:g${generation}:n${checked}${parentSuffix}`,
      ...(parent ? { parent } : {}),
    }) as Identity<TKind, K>;
  }

  return {
    forScope(input: IdentityScope): IdentityMintScope<TKind> {
      const namespace = checkedNamespace(input.namespace);
      const generation = checkedGeneration(input.generation);
      const scope: IdentityScope = Object.freeze({ namespace, generation });
      return {
        scope,
        mint<K extends TKind>(
          kind: K,
          ordinal: number,
          parent?: Identity<TKind>,
        ): Identity<TKind, K> {
          return mintIdentity(kind, namespace, generation, ordinal, parent);
        },
      };
    },
    sameIdentity,
  };
}
