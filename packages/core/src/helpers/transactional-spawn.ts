/**
 * Atomic native + semantic creation, and a registration host for bodies
 * created elsewhere.
 *
 * `spawnRegistered` is the generalized `createNative` sequence: create body →
 * add shapes → read identities → register body → register shapes. A
 * `bodyRegistered` flag drives try/finally rollback that unregisters THEN
 * destroys, so a failure at any step leaves neither an orphaned native object
 * nor a stale registration.
 *
 * `createRegistrationHost` is the generalized registration boundary for
 * bodies/shapes created by an outer native owner. `registerShape` unregisters
 * the body on failure so that owner can destroy the native object exactly
 * once. `registerBody` does not roll back on failure: a duplicate-handle error
 * must never remove a pre-existing valid registration.
 */
import type { EntityRegistry, RegisteredBody, RegisteredShape } from './entity-registry.js';
import type {
  BodyHandle,
  BodyOptions,
  HullOptions,
  ShapeHandle,
  ShapeIdentity,
  ShapeMaterial,
  Vec3,
} from '../types.js';

export interface SpawnWorld {
  createBody(options?: BodyOptions): BodyHandle;
  destroyBody(body: BodyHandle): void;
  addBox(body: BodyHandle, half: Vec3, material?: ShapeMaterial): ShapeHandle;
  addSphere(body: BodyHandle, radius: number, material?: ShapeMaterial): ShapeHandle;
  addCapsule(
    body: BodyHandle,
    radius: number,
    halfHeight: number,
    material?: ShapeMaterial,
  ): ShapeHandle;
  addSensorBox(body: BodyHandle, half: Vec3): ShapeHandle;
  addHull(
    body: BodyHandle,
    points: readonly Vec3[] | Float32Array,
    options?: HullOptions,
  ): ShapeHandle;
  getShapeIdentity(shape: ShapeHandle): ShapeIdentity | null;
}

export interface RegistrationWorld {
  destroyBody(body: BodyHandle): void;
  getShapeIdentity(shape: ShapeHandle): ShapeIdentity | null;
}

export type SpawnShapeSpec =
  | {
      readonly kind: 'box';
      readonly half: Vec3;
      readonly material?: ShapeMaterial;
    }
  | {
      readonly kind: 'sphere';
      readonly radius: number;
      readonly material?: ShapeMaterial;
    }
  | {
      readonly kind: 'capsule';
      readonly radius: number;
      readonly halfHeight: number;
      readonly material?: ShapeMaterial;
    }
  | {
      readonly kind: 'sensorBox';
      readonly half: Vec3;
    }
  | {
      readonly kind: 'hull';
      readonly points: readonly Vec3[] | Float32Array;
      readonly options?: HullOptions;
    };

export interface SpawnRegisteredOptions<TAddress> {
  readonly body?: BodyOptions;
  readonly bodyAddress: TAddress;
  readonly shapes: readonly SpawnShapeSpec[];
}

export interface SpawnedShape<TAddress> {
  readonly kind: SpawnShapeSpec['kind'];
  readonly shape: ShapeHandle;
  readonly identity: ShapeIdentity;
  readonly registration: RegisteredShape<TAddress>;
}

export interface SpawnRegisteredResult<TAddress> {
  readonly body: BodyHandle;
  readonly bodyRegistration: RegisteredBody<TAddress>;
  readonly shapes: readonly SpawnedShape<TAddress>[];
}

export interface RegistrationHostOptions<TAddress> {
  readonly world: RegistrationWorld;
  readonly registry: EntityRegistry<TAddress>;
  readonly participantKey: string;
  /** When supplied, every registered address must belong to this host. */
  readonly belongsToHost?: (address: TAddress) => boolean;
}

export interface RegistrationHostSnapshot {
  readonly participantKey: string;
  readonly revision: number;
  readonly bodies: readonly BodyHandle[];
  readonly shapes: readonly ShapeIdentity[];
  readonly disposed: boolean;
}

function copyShapeIdentity(identity: ShapeIdentity): ShapeIdentity {
  return Object.freeze({
    index1: identity.index1,
    world0: identity.world0,
    generation: identity.generation,
  });
}

function shapeKey(identity: ShapeIdentity): string {
  return `${identity.world0}:${identity.index1}:g${identity.generation}`;
}

function checkedHandle(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer handle`);
  }
  return value;
}

function addSpawnShape(
  world: SpawnWorld,
  body: BodyHandle,
  spec: SpawnShapeSpec,
): ShapeHandle {
  switch (spec.kind) {
    case 'box':
      return world.addBox(body, spec.half, spec.material);
    case 'sphere':
      return world.addSphere(body, spec.radius, spec.material);
    case 'capsule':
      return world.addCapsule(body, spec.radius, spec.halfHeight, spec.material);
    case 'sensorBox':
      return world.addSensorBox(body, spec.half);
    case 'hull':
      return world.addHull(body, spec.points, spec.options);
    default: {
      const kind = (spec as { kind: string }).kind;
      throw new TypeError(`transactional spawn: unsupported shape kind ${String(kind)}`);
    }
  }
}

function requireShapeIdentity(
  world: RegistrationWorld,
  shape: ShapeHandle,
  label: string,
): ShapeIdentity {
  const identity = world.getShapeIdentity(shape);
  if (identity === null) {
    throw new Error(`${label}: Box3D returned no shape identity`);
  }
  return copyShapeIdentity(identity);
}

/**
 * Create a body, attach shapes, and register them as one transaction.
 * Throws restore the native and registry baseline exactly.
 */
export function spawnRegistered<TAddress>(
  world: SpawnWorld,
  registry: EntityRegistry<TAddress>,
  options: SpawnRegisteredOptions<TAddress>,
): SpawnRegisteredResult<TAddress> {
  if (world === null || typeof world !== 'object') {
    throw new TypeError('transactional spawn requires a world');
  }
  if (registry === null || typeof registry !== 'object') {
    throw new TypeError('transactional spawn requires an entity registry');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('transactional spawn options must be an object');
  }
  if (!Array.isArray(options.shapes)) {
    throw new TypeError('transactional spawn shapes must be an array');
  }

  const body = world.createBody(options.body);
  checkedHandle(body as number, 'transactional spawn body');
  let bodyRegistered = false;
  try {
    const created: { kind: SpawnShapeSpec['kind']; shape: ShapeHandle; identity: ShapeIdentity }[] =
      [];
    for (const spec of options.shapes) {
      if (spec === null || typeof spec !== 'object') {
        throw new TypeError('transactional spawn shape spec must be an object');
      }
      const shape = addSpawnShape(world, body, spec);
      checkedHandle(shape as number, 'transactional spawn shape');
      created.push({
        kind: spec.kind,
        shape,
        identity: requireShapeIdentity(world, shape, 'transactional spawn'),
      });
    }

    const bodyRegistration = registry.registerBody(body, options.bodyAddress);
    bodyRegistered = true;

    const shapes = created.map((entry) => {
      const registration = registry.registerShape(entry.shape, body, entry.identity);
      return Object.freeze({
        kind: entry.kind,
        shape: entry.shape,
        identity: entry.identity,
        registration,
      }) as SpawnedShape<TAddress>;
    });

    return Object.freeze({
      body,
      bodyRegistration,
      shapes: Object.freeze(shapes),
    }) as SpawnRegisteredResult<TAddress>;
  } catch (error) {
    try {
      if (bodyRegistered) registry.unregisterBody(body);
    } finally {
      world.destroyBody(body);
    }
    throw error;
  }
}

export class RegistrationHost<TAddress> {
  readonly participantKey: string;
  private disposed = false;
  private revisionValue = 0;
  private readonly bodies = new Set<number>();
  private readonly shapes = new Map<string, ShapeIdentity>();
  private readonly world: RegistrationWorld;
  private readonly registry: EntityRegistry<TAddress>;
  private readonly belongsToHost?: (address: TAddress) => boolean;

  constructor(options: RegistrationHostOptions<TAddress>) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('registration host options must be an object');
    }
    if (options.world === null || typeof options.world !== 'object') {
      throw new TypeError('registration host requires a world');
    }
    if (options.registry === null || typeof options.registry !== 'object') {
      throw new TypeError('registration host requires an entity registry');
    }
    if (typeof options.participantKey !== 'string' || options.participantKey.length === 0) {
      throw new TypeError('registration host participantKey must be a non-empty string');
    }
    if (
      options.belongsToHost !== undefined &&
      typeof options.belongsToHost !== 'function'
    ) {
      throw new TypeError('registration host belongsToHost must be a function when supplied');
    }
    this.world = options.world;
    this.registry = options.registry;
    this.participantKey = options.participantKey;
    this.belongsToHost = options.belongsToHost;
  }

  get revision(): number {
    return this.revisionValue;
  }

  registerBody(body: BodyHandle, address: TAddress): RegisteredBody<TAddress> {
    this.assertLive();
    checkedHandle(body as number, 'body');
    if (this.belongsToHost !== undefined && !this.belongsToHost(address)) {
      throw new Error('body address does not belong to this host');
    }
    // registerBody validates before mutating. Do not roll back on failure:
    // a duplicate-handle error must never remove the pre-existing valid
    // registration.
    const registration = this.registry.registerBody(body, address);
    this.bodies.add(body as number);
    return registration;
  }

  registerShape(shape: ShapeHandle, body: BodyHandle): RegisteredShape<TAddress> {
    this.assertLive();
    checkedHandle(shape as number, 'shape');
    const bodyNumber = checkedHandle(body as number, 'body');
    if (!this.bodies.has(bodyNumber)) {
      throw new Error('shape body is not owned by this host');
    }
    try {
      const identity = requireShapeIdentity(this.world, shape, 'registration host');
      const registration = this.registry.registerShape(shape, body, identity);
      this.shapes.set(shapeKey(identity), identity);
      return registration;
    } catch (error) {
      // The runtime that created the native body owns native rollback. Remove
      // the partial semantic registration so its outer transaction can destroy
      // the body exactly once.
      this.unregisterBody(body);
      throw error;
    }
  }

  /** Remove semantic ownership after the native owner destroys the body. */
  unregisterBody(body: BodyHandle): boolean {
    const bodyNumber = checkedHandle(body as number, 'body');
    if (!this.bodies.has(bodyNumber)) return false;
    this.registry.unregisterBody(body);
    this.bodies.delete(bodyNumber);
    for (const [key, identity] of this.shapes) {
      if (this.registry.resolveShape(identity) === undefined) this.shapes.delete(key);
    }
    return true;
  }

  destroyBody(body: BodyHandle): boolean {
    const bodyNumber = checkedHandle(body as number, 'body');
    if (!this.bodies.has(bodyNumber)) return false;
    let firstError: unknown;
    try {
      this.world.destroyBody(body);
    } catch (error) {
      firstError = error;
    } finally {
      this.unregisterBody(body);
    }
    if (firstError !== undefined) throw firstError;
    return true;
  }

  /** Mark one successful participant reset; bodies are managed by the runtime. */
  advanceRevision(): number {
    this.assertLive();
    this.revisionValue += 1;
    return this.revisionValue;
  }

  snapshot(): RegistrationHostSnapshot {
    this.assertLive();
    return Object.freeze({
      participantKey: this.participantKey,
      revision: this.revisionValue,
      bodies: Object.freeze(
        [...this.bodies]
          .sort((left, right) => left - right)
          .map((body) => body as BodyHandle),
      ),
      shapes: Object.freeze(
        [...this.shapes.values()]
          .sort(
            (left, right) =>
              left.world0 - right.world0 ||
              left.index1 - right.index1 ||
              left.generation - right.generation,
          )
          .map(copyShapeIdentity),
      ),
      disposed: this.disposed,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    const bodies = [...this.bodies];
    let firstError: unknown;
    try {
      for (const body of bodies) {
        try {
          this.destroyBody(body as BodyHandle);
        } catch (error) {
          if (firstError === undefined) firstError = error;
        }
      }
    } finally {
      this.markDisposed();
    }
    if (firstError !== undefined) throw firstError;
  }

  private markDisposed(): void {
    this.bodies.clear();
    this.shapes.clear();
    this.disposed = true;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('registration host used after dispose()');
  }
}

export function createRegistrationHost<TAddress>(
  options: RegistrationHostOptions<TAddress>,
): RegistrationHost<TAddress> {
  return new RegistrationHost(options);
}
