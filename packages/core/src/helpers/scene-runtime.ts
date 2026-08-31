/**
 * Generic scene authority for one shared `World` and any number of
 * `SceneParticipant` instances.
 *
 * Owns one `FixedStepper` over one shared `World`. Per fixed step: apply due
 * commands → one `world.step(fixedDt, substeps)` → one shape-aware triple drain
 * (begins/ends/hits WithShapes) → freeze the batch → fan to participants sorted
 * by `participantKey` → capture drained events into a bounded envelope queue.
 *
 * Command `type` is an opaque string. Payload handling stays with participants
 * via `prepareSceneCommand` / `sceneCommandPolicy`. Unknown command types are
 * treated as `critical`. The runtime does not interpret addresses.
 *
 * ## Reset barrier
 *
 * `reset()` drains all three native shape-aware contact queues (begin, end, and
 * hit) so stale shape/body handles sitting in those queues can never be
 * interpreted against replacement bodies on the next tick. This drain is the
 * reset barrier: it is not optional and it runs even when no participants are
 * attached.
 */
import { FixedStepper } from './fixed-step.js';
import type {
  SceneCommandEnvelope,
  SceneCommandPolicy,
  SceneContactBatch,
  SceneParticipant,
} from './scene-participant.js';
import type { World } from '../index.js';
import type {
  ContactBeginEventWithShapes,
  ContactEndEventWithShapes,
  ContactHitEventWithShapes,
  ShapeIdentity,
} from '../types.js';

export interface SceneCommandInput {
  readonly targetParticipantKey: string;
  readonly type: string;
  readonly payload: unknown;
}

export interface SceneEventEnvelope<TEvent = unknown> {
  readonly sceneEpoch: number;
  readonly fixedStep: number;
  readonly sequence: number;
  readonly participantKey: string;
  readonly participantRevision: number;
  readonly event: TEvent;
}

export interface SceneRuntimeTelemetry {
  readonly queued: number;
  readonly coalesced: number;
  readonly dropped: number;
  readonly rejected: number;
  readonly retained: number;
  readonly droppedEvents: number;
  readonly faults: number;
  readonly unroutedContacts: number;
  readonly faulted: boolean;
}

export interface SceneRuntimeOptions {
  readonly world: World;
  readonly stepper?: FixedStepper;
  readonly commandCapacity?: number;
  readonly eventCapacity?: number;
  readonly fixedDt?: number;
  readonly substeps?: number;
  readonly maxStepsPerFrame?: number;
  /**
   * Optional contact classifier. Invoked for each frozen contact-begin after
   * the triple drain. The runtime never inspects addresses itself.
   */
  readonly classifyContact?: (
    begin: ContactBeginEventWithShapes,
  ) => 'routed' | 'unrouted';
}

function cloneIdentity(id: ShapeIdentity): ShapeIdentity {
  return Object.freeze({
    index1: id.index1,
    world0: id.world0,
    generation: id.generation,
  });
}

function clonePayloadValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(clonePayloadValue));
  const copy: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    copy[key] = clonePayloadValue(nested);
  }
  return Object.freeze(copy);
}

function clonePayload(payload: unknown): unknown {
  return clonePayloadValue(payload);
}

function freezeBatch(
  begins: readonly ContactBeginEventWithShapes[],
  ends: readonly ContactEndEventWithShapes[],
  hits: readonly ContactHitEventWithShapes[],
): SceneContactBatch {
  const b = begins.map((e) =>
    Object.freeze({
      ...e,
      shapeA: cloneIdentity(e.shapeA),
      shapeB: cloneIdentity(e.shapeB),
    }),
  );
  const en = ends.map((e) =>
    Object.freeze({
      ...e,
      shapeA: cloneIdentity(e.shapeA),
      shapeB: cloneIdentity(e.shapeB),
    }),
  );
  const h = hits.map((e) =>
    Object.freeze({
      ...e,
      point: Object.freeze({ ...e.point }),
      normal: Object.freeze({ ...e.normal }),
      shapeA: cloneIdentity(e.shapeA),
      shapeB: cloneIdentity(e.shapeB),
    }),
  );
  return Object.freeze({
    begins: Object.freeze(b),
    ends: Object.freeze(en),
    hits: Object.freeze(h),
  });
}

function checkedPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function checkedFixedDt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      'scene runtime fixedDt must be a finite number greater than 0',
    );
  }
  return value;
}

function checkedSubsteps(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('scene runtime substeps must be an integer >= 1');
  }
  return value;
}

export class SceneRuntime<TEvent = unknown> {
  readonly world: World;
  readonly stepper: FixedStepper;
  private readonly commandCapacity: number;
  private readonly eventCapacity: number;
  private readonly classifyContact?: (
    begin: ContactBeginEventWithShapes,
  ) => 'routed' | 'unrouted';
  private readonly adapters = new Map<string, SceneParticipant<TEvent>>();
  private commands: SceneCommandEnvelope[] = [];
  private events: SceneEventEnvelope<TEvent>[] = [];
  private sequence = 0;
  private eventSequence = 0;
  private fixedStepIndex = 0;
  private epoch = 0;
  private disposed = false;
  private faulted = false;
  private queued = 0;
  private coalesced = 0;
  private dropped = 0;
  private rejected = 0;
  private retained = 0;
  private droppedEvents = 0;
  private faults = 0;
  private unroutedContacts = 0;

  constructor(options: SceneRuntimeOptions) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('scene runtime options must be an object');
    }
    if (options.world === null || options.world === undefined) {
      throw new TypeError('scene runtime requires a world');
    }
    this.world = options.world;
    this.classifyContact = options.classifyContact;

    const commandCapacity = checkedPositiveInteger(
      options.commandCapacity ?? 128,
      'commandCapacity',
    );
    const eventCapacity = checkedPositiveInteger(
      options.eventCapacity ?? 1024,
      'eventCapacity',
    );
    this.commandCapacity = commandCapacity;
    this.eventCapacity = eventCapacity;

    if (options.stepper !== undefined) {
      checkedFixedDt(options.stepper.fixedDt);
      checkedSubsteps(options.stepper.substeps);
      this.stepper = options.stepper;
    } else {
      const fixedDt = checkedFixedDt(options.fixedDt ?? 1 / 60);
      const substeps = checkedSubsteps(options.substeps ?? 4);
      const maxStepsPerFrame = checkedPositiveInteger(
        options.maxStepsPerFrame ?? 3,
        'maxStepsPerFrame',
      );
      this.stepper = new FixedStepper({ fixedDt, substeps, maxStepsPerFrame });
    }
  }

  attach(adapter: SceneParticipant<TEvent>): void {
    this.assertLive();
    if (adapter.physicsWorld !== this.world) {
      throw new Error('participant belongs to a different physics world');
    }
    if (
      Math.abs(adapter.fixedDt - this.stepper.fixedDt) > 1e-12 ||
      adapter.substeps !== this.stepper.substeps
    ) {
      throw new Error('participant timing is incompatible with scene');
    }
    if (this.adapters.has(adapter.participantKey)) {
      throw new Error(`participant ${adapter.participantKey} is already attached`);
    }
    this.adapters.set(adapter.participantKey, adapter);
    try {
      adapter.attachSceneOwner(this);
    } catch (error) {
      this.adapters.delete(adapter.participantKey);
      throw error;
    }
  }

  detach(adapterOrKey: SceneParticipant<TEvent> | string): void {
    const key =
      typeof adapterOrKey === 'string' ? adapterOrKey : adapterOrKey.participantKey;
    const adapter = this.adapters.get(key);
    if (adapter === undefined) return;
    try {
      adapter.detachSceneOwner(this);
    } finally {
      this.purgeParticipant(key);
      this.adapters.delete(key);
    }
  }

  /** Remove queued input and retained output for a participant being replaced. */
  purgeParticipant(participantKey: string): void {
    const participant = this.adapters.get(participantKey);
    const pending = this.commands.filter(
      (command) => command.targetParticipantKey === participantKey,
    );
    this.commands = this.commands.filter(
      (command) => command.targetParticipantKey !== participantKey,
    );
    for (const command of pending) {
      if (this.commandPolicy(participant, command.type) === 'critical') {
        this.rejected += 1;
      } else {
        this.dropped += 1;
      }
    }
    const retained = this.events.filter(
      (event) => event.participantKey === participantKey,
    ).length;
    if (retained > 0) {
      this.events = this.events.filter(
        (event) => event.participantKey !== participantKey,
      );
      this.retained = this.events.length;
      this.droppedEvents += retained;
    }
  }

  enqueueCommand(input: SceneCommandInput): SceneCommandEnvelope {
    this.assertHealthy();
    const adapter = this.adapters.get(input.targetParticipantKey);
    if (adapter === undefined) {
      throw new Error(`unknown participant ${input.targetParticipantKey}`);
    }
    if (this.commandPolicy(adapter, input.type) === 'coalescible') {
      const existing = this.commands.find(
        (c) =>
          c.targetParticipantKey === input.targetParticipantKey &&
          c.type === input.type,
      );
      if (existing) {
        const clonedPayload = clonePayload(input.payload);
        const replacement = Object.freeze({
          ...existing,
          payload:
            adapter.prepareSceneCommand?.(input.type, clonedPayload) ??
            clonedPayload,
        }) as SceneCommandEnvelope;
        this.commands[this.commands.indexOf(existing)] = replacement;
        this.coalesced += 1;
        return replacement;
      }
    }
    if (this.commands.length >= this.commandCapacity) {
      const index = this.commands.findIndex(
        (c) =>
          this.commandPolicy(this.adapters.get(c.targetParticipantKey), c.type) ===
          'coalescible',
      );
      if (index >= 0) {
        this.commands.splice(index, 1);
        this.dropped += 1;
      } else {
        this.rejected += 1;
        throw new RangeError('scene runtime command queue is full');
      }
    }
    const clonedPayload = clonePayload(input.payload);
    const preparedPayload =
      adapter.prepareSceneCommand?.(input.type, clonedPayload) ?? clonedPayload;
    const command = Object.freeze({
      sequence: ++this.sequence,
      sceneEpoch: this.epoch,
      fixedStepIndex: this.fixedStepIndex + 1,
      targetParticipantKey: input.targetParticipantKey,
      targetRevision: adapter.revision,
      type: input.type,
      payload: preparedPayload,
    }) as SceneCommandEnvelope;
    this.commands.push(command);
    this.queued += 1;
    return command;
  }

  advance(delta: number): number {
    this.assertHealthy();
    if (!Number.isFinite(delta) || delta < 0) {
      throw new RangeError('delta must be finite and non-negative');
    }
    let stepped = 0;
    let firstFault: unknown;
    try {
      this.stepper.advance(delta, () => {
        this.fixedStepIndex += 1;
        this.applyCommands();
        this.world.step(this.stepper.fixedDt, this.stepper.substeps);
        const batch = freezeBatch(
          this.world.drainContactBeginEventsWithShapes(),
          this.world.drainContactEndEventsWithShapes(),
          this.world.drainContactHitEventsWithShapes(),
        );
        this.classifyContacts(batch);
        for (const adapter of this.sortedParticipants()) {
          try {
            adapter.sceneFixedStep(this, batch);
            this.captureEvents(adapter);
          } catch (error) {
            this.recordFault(error);
            if (firstFault === undefined) firstFault = error;
          }
        }
        stepped += 1;
      });
      for (const adapter of this.sortedParticipants()) {
        try {
          adapter.finishSceneFrame(this, delta, stepped > 0);
        } catch (error) {
          this.recordFault(error);
          if (firstFault === undefined) firstFault = error;
        }
      }
      if (firstFault !== undefined) throw firstFault;
      return stepped;
    } catch (error) {
      if (!this.faulted) this.recordFault(error);
      throw error;
    }
  }

  drainEvents(): readonly SceneEventEnvelope<TEvent>[] {
    const drained = this.events;
    this.events = [];
    this.retained = 0;
    return Object.freeze(drained);
  }

  /**
   * Restore a healthy runtime: clear queued commands and retained events, bump
   * the scene epoch, reset participant clocks, and run the reset barrier.
   */
  reset(): void {
    this.assertLive();
    this.commands = [];
    this.events = [];
    this.retained = 0;
    this.stepper.reset();
    this.fixedStepIndex = 0;
    this.epoch += 1;
    let firstError: unknown;
    for (const adapter of this.sortedParticipants()) {
      try {
        adapter.sceneReset(this);
      } catch (error) {
        this.recordFault(error);
        if (firstError === undefined) firstError = error;
      }
      try {
        adapter.sceneResetClock(this);
      } catch (error) {
        this.recordFault(error);
        if (firstError === undefined) firstError = error;
      }
    }
    // Reset barrier: stale shape/body handles must not be interpreted against
    // replacement bodies on the next tick.
    try {
      this.world.drainContactBeginEventsWithShapes();
      this.world.drainContactEndEventsWithShapes();
      this.world.drainContactHitEventsWithShapes();
    } catch (error) {
      this.recordFault(error);
      if (firstError === undefined) firstError = error;
    }
    if (firstError !== undefined) throw firstError;
    this.faulted = false;
  }

  telemetry(): SceneRuntimeTelemetry {
    return Object.freeze({
      queued: this.queued,
      coalesced: this.coalesced,
      dropped: this.dropped,
      rejected: this.rejected,
      retained: this.retained,
      droppedEvents: this.droppedEvents,
      faults: this.faults,
      unroutedContacts: this.unroutedContacts,
      faulted: this.faulted,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const adapter of [...this.adapters.values()]) this.detach(adapter);
    this.commands = [];
    this.events = [];
    this.retained = 0;
    this.disposed = true;
  }

  private applyCommands(): void {
    const due = this.commands
      .filter(
        (c) => c.sceneEpoch === this.epoch && c.fixedStepIndex <= this.fixedStepIndex,
      )
      .sort(
        (a, b) => a.fixedStepIndex - b.fixedStepIndex || a.sequence - b.sequence,
      );
    this.commands = this.commands.filter((c) => !due.includes(c));
    for (const command of due) {
      const adapter = this.adapters.get(command.targetParticipantKey);
      if (!adapter) {
        if (this.commandPolicy(undefined, command.type) === 'critical') {
          this.rejected += 1;
        } else {
          this.dropped += 1;
        }
        throw new Error(
          `command target ${command.targetParticipantKey} is no longer attached`,
        );
      }
      if (command.targetRevision !== adapter.revision) {
        if (this.commandPolicy(adapter, command.type) === 'critical') {
          this.rejected += 1;
        } else {
          this.dropped += 1;
        }
        throw new Error(
          `stale command revision for ${command.targetParticipantKey}`,
        );
      }
      adapter.applySceneCommand(this, command);
    }
  }

  private captureEvents(adapter: SceneParticipant<TEvent>): void {
    for (const event of adapter.drainSceneEvents(this)) {
      if (this.events.length >= this.eventCapacity) {
        this.events.shift();
        this.droppedEvents += 1;
      }
      this.events.push(
        Object.freeze({
          sceneEpoch: this.epoch,
          fixedStep: this.fixedStepIndex,
          sequence: ++this.eventSequence,
          participantKey: adapter.participantKey,
          participantRevision: adapter.revision,
          event,
        }),
      );
      this.retained = this.events.length;
    }
  }

  private classifyContacts(batch: SceneContactBatch): void {
    const classify = this.classifyContact;
    if (classify === undefined) return;
    for (const begin of batch.begins) {
      if (classify(begin) === 'unrouted') this.unroutedContacts += 1;
    }
  }

  private sortedParticipants(): SceneParticipant<TEvent>[] {
    return [...this.adapters.values()].sort((a, b) =>
      a.participantKey.localeCompare(b.participantKey),
    );
  }

  private commandPolicy(
    participant: SceneParticipant<TEvent> | undefined,
    type: string,
  ): SceneCommandPolicy {
    return participant?.sceneCommandPolicy?.(type) ?? 'critical';
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('scene runtime used after dispose()');
  }

  private assertHealthy(): void {
    this.assertLive();
    if (this.faulted) throw new Error('scene runtime is faulted; call reset()');
  }

  private recordFault(error: unknown): void {
    void error;
    this.faulted = true;
    this.faults += 1;
  }
}

export function createSceneRuntime<TEvent = unknown>(
  options: SceneRuntimeOptions,
): SceneRuntime<TEvent> {
  return new SceneRuntime(options);
}
