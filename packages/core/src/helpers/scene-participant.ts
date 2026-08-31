/**
 * Generic scene-participant contract.
 *
 * A participant is something a shared-world scene scheduler can step, command,
 * and reset. It is not a physics-world mirror: the participant holds a `World`
 * handle-bag and its own revision/key, and the scheduler never infers ownership
 * from a scene graph.
 *
 * Unknown command types must be treated as `critical` by schedulers — including
 * types for which `sceneCommandPolicy` is unimplemented or returns nothing.
 */
import type { World } from '../index.js';
import type {
  BodyHandle,
  ContactBeginEventWithShapes,
  ContactEndEventWithShapes,
  ContactHitEventWithShapes,
  ShapeIdentity,
} from '../types.js';

export interface SceneContactBatch {
  readonly begins: readonly ContactBeginEventWithShapes[];
  readonly ends: readonly ContactEndEventWithShapes[];
  readonly hits: readonly ContactHitEventWithShapes[];
}

export interface SceneCommandEnvelope {
  readonly sequence: number;
  readonly sceneEpoch: number;
  readonly fixedStepIndex: number;
  readonly targetParticipantKey: string;
  readonly targetRevision: number;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * Scheduler hint for a scene command.
 *
 * - `critical` — must be applied; cannot be dropped or coalesced away.
 * - `coalescible` — a later command of the same type for the same participant
 *   may replace an earlier queued one.
 *
 * Unknown command types must be treated as `critical` by schedulers.
 */
export type SceneCommandPolicy = 'critical' | 'coalescible';

export interface SceneParticipant<TEvent = unknown> {
  readonly participantKey: string;
  readonly revision: number;
  readonly physicsWorld: World;
  readonly fixedDt: number;
  readonly substeps: number;
  dispose(): void;
  attachSceneOwner(owner: object): void;
  detachSceneOwner(owner: object): void;
  prepareSceneCommand?(type: string, payload: unknown): unknown;
  sceneCommandPolicy?(type: string): SceneCommandPolicy;
  applySceneCommand(owner: object, command: SceneCommandEnvelope): void;
  sceneFixedStep(owner: object, batch: SceneContactBatch): void;
  finishSceneFrame(owner: object, delta: number, stepped: boolean): void;
  drainSceneEvents(owner: object): readonly TEvent[];
  sceneReset(owner: object): void;
  sceneResetClock(owner: object): void;
  ownsBody?(body: BodyHandle): boolean;
  resolveShape?(identity: ShapeIdentity): boolean;
}
