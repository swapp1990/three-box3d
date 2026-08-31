/**
 * Instance-local semantic routing for Box3D handles.
 *
 * The registry does not allocate or recycle handles. Box3D remains the source
 * of stable shape identity; raw shape handles are lifecycle metadata, while
 * raw body handles remain temporary lifecycle-scoped routing keys.
 *
 * Callers supply `addressKey` (unique per address) and optional `groupKey`
 * (group-scoped queries / unregistration). The registry never interprets
 * address fields itself.
 *
 * World affinity is enforced two ways: a semantic world key (constructed-with
 * or latched from the first successful body registration via `addressWorldKey`)
 * and native `world0` consistency across registered shapes. `clear()` removes
 * entries but keeps both affinities.
 */
import type { BodyHandle, ShapeHandle, ShapeIdentity } from '../types.js';
import {
  MAX_NATIVE_GENERATION,
  MAX_NATIVE_SHAPE_INDEX,
  MAX_NATIVE_WORLDS,
} from '../limits.js';

export interface RegisteredBody<TAddress> {
  readonly body: BodyHandle;
  readonly address: TAddress;
}

export interface RegisteredShape<TAddress> {
  readonly shape: ShapeHandle;
  readonly identity: ShapeIdentity;
  readonly body: BodyHandle;
  readonly bodyRegistration: RegisteredBody<TAddress>;
}

export interface EntityRegistryStats {
  readonly bodyCount: number;
  readonly shapeCount: number;
  readonly groupCount: number;
  readonly groupBodyCount: number;
  readonly ungroupedBodyCount: number;
}

export interface EntityRegistrySnapshot<TAddress> {
  readonly stats: EntityRegistryStats;
  readonly bodies: readonly RegisteredBody<TAddress>[];
  readonly shapes: readonly RegisteredShape<TAddress>[];
}

export interface EntityRegistryOptions<TAddress> {
  /** Unique key per address. Replaces a hard-coded leaf-precedence address key. */
  readonly addressKey: (address: TAddress) => string;
  /** Optional grouping key. Powers group-scoped queries and unregistration. */
  readonly groupKey?: (address: TAddress) => string | undefined;
  /**
   * Semantic world key this registry is bound to. When omitted, latched from
   * the first successful body registration (requires `addressWorldKey`).
   */
  readonly worldKey?: string;
  /** Extract the semantic world key from an address. */
  readonly addressWorldKey?: (address: TAddress) => string;
}

function checkedHandle(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer handle`);
  }
  return value;
}

function assertObject(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }
}

function freezeAddress<TAddress>(address: TAddress): TAddress {
  if (address === null || typeof address !== 'object') return address;
  return Object.freeze({ ...address }) as TAddress;
}

function checkedShapeIdentity(value: ShapeIdentity): ShapeIdentity {
  assertObject(value, 'shapeIdentity');
  if (
    !Number.isSafeInteger(value.index1) ||
    value.index1 <= 0 ||
    value.index1 > MAX_NATIVE_SHAPE_INDEX
  ) {
    throw new RangeError(
      `shapeIdentity.index1 must be in the native range 1..${MAX_NATIVE_SHAPE_INDEX}`,
    );
  }
  if (
    !Number.isSafeInteger(value.world0) ||
    value.world0 < 0 ||
    value.world0 >= MAX_NATIVE_WORLDS
  ) {
    throw new RangeError(
      `shapeIdentity.world0 must be in the native world range 0..${MAX_NATIVE_WORLDS - 1}`,
    );
  }
  if (
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    value.generation > MAX_NATIVE_GENERATION
  ) {
    throw new RangeError(
      `shapeIdentity.generation must be in the uint16 range 0..${MAX_NATIVE_GENERATION}`,
    );
  }
  return Object.freeze({
    index1: value.index1,
    world0: value.world0,
    generation: value.generation,
  });
}

function shapeKey(identity: ShapeIdentity): string {
  return `${identity.world0}:${identity.index1}:g${identity.generation}`;
}

function compareBodies<TAddress>(
  left: RegisteredBody<TAddress>,
  right: RegisteredBody<TAddress>,
): number {
  return (left.body as number) - (right.body as number);
}

function compareShapes<TAddress>(
  left: RegisteredShape<TAddress>,
  right: RegisteredShape<TAddress>,
): number {
  const leftIdentity = left.identity;
  const rightIdentity = right.identity;
  return (
    leftIdentity.world0 - rightIdentity.world0 ||
    leftIdentity.index1 - rightIdentity.index1 ||
    leftIdentity.generation - rightIdentity.generation ||
    (left.shape as number) - (right.shape as number)
  );
}

function checkedKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must return a non-empty string`);
  }
  return value;
}

export class EntityRegistry<TAddress> {
  private activeWorld?: string;
  private activeShapeWorld0?: number;
  private readonly addressKeyOf: (address: TAddress) => string;
  private readonly groupKeyOf?: (address: TAddress) => string | undefined;
  private readonly addressWorldKeyOf?: (address: TAddress) => string;
  private readonly bodies = new Map<number, RegisteredBody<TAddress>>();
  private readonly bodyKeys = new Map<string, number>();
  private readonly shapes = new Map<string, RegisteredShape<TAddress>>();
  private readonly shapeHandles = new Map<number, string>();
  private readonly bodyShapes = new Map<number, Set<string>>();
  private readonly groupBodies = new Map<string, Set<number>>();

  constructor(options: EntityRegistryOptions<TAddress>) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('entity registry options must be an object');
    }
    if (typeof options.addressKey !== 'function') {
      throw new TypeError('entity registry addressKey must be a function');
    }
    if (options.groupKey !== undefined && typeof options.groupKey !== 'function') {
      throw new TypeError('entity registry groupKey must be a function when supplied');
    }
    if (
      options.addressWorldKey !== undefined &&
      typeof options.addressWorldKey !== 'function'
    ) {
      throw new TypeError(
        'entity registry addressWorldKey must be a function when supplied',
      );
    }
    if (options.worldKey !== undefined) {
      if (typeof options.worldKey !== 'string' || options.worldKey.length === 0) {
        throw new TypeError(
          'entity registry worldKey must be a non-empty string when supplied',
        );
      }
      this.activeWorld = options.worldKey;
    }
    this.addressKeyOf = options.addressKey;
    this.groupKeyOf = options.groupKey;
    this.addressWorldKeyOf = options.addressWorldKey;
  }

  registerBody(body: BodyHandle, address: TAddress): RegisteredBody<TAddress> {
    const bodyNumber = checkedHandle(body as number, 'body');
    const validatedAddress = freezeAddress(address);
    const key = checkedKey(
      this.addressKeyOf(validatedAddress),
      'entity registry addressKey',
    );
    const group = this.resolveGroupKey(validatedAddress);
    const world = this.resolveAddressWorld(validatedAddress);
    if (world !== undefined) this.assertWorld(world);
    if (this.bodies.has(bodyNumber)) {
      throw new Error(`entity registry: body ${bodyNumber} is already registered`);
    }
    if (this.bodyKeys.has(key)) {
      throw new Error(`entity registry: address ${key} is already registered`);
    }

    const registration = Object.freeze({
      body,
      address: validatedAddress,
    }) as RegisteredBody<TAddress>;
    this.bodies.set(bodyNumber, registration);
    this.bodyKeys.set(key, bodyNumber);
    this.bodyShapes.set(bodyNumber, new Set());
    if (group !== undefined) {
      let entries = this.groupBodies.get(group);
      if (entries === undefined) {
        entries = new Set();
        this.groupBodies.set(group, entries);
      }
      entries.add(bodyNumber);
    }
    return registration;
  }

  registerShape(
    shape: ShapeHandle,
    body: BodyHandle,
    identity: ShapeIdentity,
  ): RegisteredShape<TAddress> {
    const shapeNumber = checkedHandle(shape as number, 'shape');
    const bodyNumber = checkedHandle(body as number, 'body');
    const validatedIdentity = checkedShapeIdentity(identity);
    const bodyRegistration = this.bodies.get(bodyNumber);
    if (bodyRegistration === undefined) {
      throw new Error(`entity registry: body ${bodyNumber} is not registered`);
    }
    this.assertShapeWorld(validatedIdentity.world0);
    const key = shapeKey(validatedIdentity);
    if (this.shapes.has(key)) {
      throw new Error(`entity registry: shape identity ${key} is already registered`);
    }
    if (this.shapeHandles.get(shapeNumber) !== undefined) {
      throw new Error(
        `entity registry: shape handle ${shapeNumber} is already registered`,
      );
    }

    const registration = Object.freeze({
      shape,
      identity: validatedIdentity,
      body,
      bodyRegistration,
    }) as RegisteredShape<TAddress>;
    this.shapes.set(key, registration);
    this.shapeHandles.set(shapeNumber, key);
    this.bodyShapes.get(bodyNumber)!.add(key);
    return registration;
  }

  resolveBody(body: BodyHandle): RegisteredBody<TAddress> | undefined {
    return this.bodies.get(checkedHandle(body as number, 'body'));
  }

  resolveShape(identity: ShapeIdentity): RegisteredShape<TAddress> | undefined {
    return this.shapes.get(shapeKey(checkedShapeIdentity(identity)));
  }

  unregisterShape(identity: ShapeIdentity): boolean {
    const key = shapeKey(checkedShapeIdentity(identity));
    const registration = this.shapes.get(key);
    if (registration === undefined) return false;
    this.shapes.delete(key);
    this.shapeHandles.delete(registration.shape as number);
    this.bodyShapes.get(registration.body as number)?.delete(key);
    return true;
  }

  unregisterBody(body: BodyHandle): boolean {
    const bodyNumber = checkedHandle(body as number, 'body');
    const registration = this.bodies.get(bodyNumber);
    if (registration === undefined) return false;
    const shapes = this.bodyShapes.get(bodyNumber);
    if (shapes !== undefined) {
      for (const key of shapes) {
        const shapeRegistration = this.shapes.get(key);
        if (shapeRegistration !== undefined) {
          this.shapeHandles.delete(shapeRegistration.shape as number);
        }
        this.shapes.delete(key);
      }
    }
    this.bodyShapes.delete(bodyNumber);
    this.bodies.delete(bodyNumber);
    this.bodyKeys.delete(
      checkedKey(
        this.addressKeyOf(registration.address),
        'entity registry addressKey',
      ),
    );
    const group = this.resolveGroupKey(registration.address);
    if (group !== undefined) {
      const entries = this.groupBodies.get(group);
      entries?.delete(bodyNumber);
      if (entries?.size === 0) this.groupBodies.delete(group);
    }
    return true;
  }

  /** Remove only bodies (and their shapes) owned by the supplied group. */
  unregisterGroup(groupKey: string): number {
    if (typeof groupKey !== 'string' || groupKey.length === 0) {
      throw new TypeError('entity registry group key must be a non-empty string');
    }
    const entries = this.groupBodies.get(groupKey);
    if (entries === undefined) return 0;
    const bodies = [...entries];
    for (const body of bodies) this.unregisterBody(body as BodyHandle);
    return bodies.length;
  }

  clear(): void {
    this.bodies.clear();
    this.bodyKeys.clear();
    this.shapes.clear();
    this.shapeHandles.clear();
    this.bodyShapes.clear();
    this.groupBodies.clear();
  }

  getStats(): EntityRegistryStats {
    let groupBodyCount = 0;
    for (const entries of this.groupBodies.values()) groupBodyCount += entries.size;
    return Object.freeze({
      bodyCount: this.bodies.size,
      shapeCount: this.shapes.size,
      groupCount: this.groupBodies.size,
      groupBodyCount,
      ungroupedBodyCount: this.bodies.size - groupBodyCount,
    });
  }

  snapshot(): EntityRegistrySnapshot<TAddress> {
    const bodies = [...this.bodies.values()].sort(compareBodies);
    const shapes = [...this.shapes.values()].sort(compareShapes);
    return Object.freeze({
      stats: this.getStats(),
      bodies: Object.freeze(bodies),
      shapes: Object.freeze(shapes),
    });
  }

  private resolveGroupKey(address: TAddress): string | undefined {
    if (this.groupKeyOf === undefined) return undefined;
    const group = this.groupKeyOf(address);
    if (group === undefined) return undefined;
    return checkedKey(group, 'entity registry groupKey');
  }

  private resolveAddressWorld(address: TAddress): string | undefined {
    if (this.addressWorldKeyOf === undefined) return undefined;
    return checkedKey(
      this.addressWorldKeyOf(address),
      'entity registry addressWorldKey',
    );
  }

  private assertWorld(worldKey: string): void {
    if (this.activeWorld === undefined) {
      this.activeWorld = worldKey;
      return;
    }
    if (this.activeWorld !== worldKey) {
      throw new Error('entity registry: address belongs to a different physics world');
    }
  }

  private assertShapeWorld(world0: number): void {
    if (this.activeShapeWorld0 === undefined) {
      this.activeShapeWorld0 = world0;
      return;
    }
    if (this.activeShapeWorld0 !== world0) {
      throw new Error(
        'entity registry: shape identity belongs to a different physics world',
      );
    }
  }
}

export function createEntityRegistry<TAddress>(
  options: EntityRegistryOptions<TAddress>,
): EntityRegistry<TAddress> {
  return new EntityRegistry(options);
}
