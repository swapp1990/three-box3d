import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Box3D, World } from '../src/index.js';
import type {
  SceneCommandEnvelope,
  SceneCommandPolicy,
  SceneContactBatch,
  SceneParticipant,
} from '../src/helpers/index.js';
import { createSceneRuntime, type SceneRuntime } from '../src/helpers/index.js';
import { freshBox3D } from './helpers.js';

interface TestEvent {
  readonly kind: string;
  readonly n?: number;
}

interface ParticipantHarness {
  participant: SceneParticipant<TestEvent> & { revision: number };
  stepOrder: string[];
  batches: SceneContactBatch[];
  applied: SceneCommandEnvelope[];
  boom: boolean;
  eventsPerStep: number;
}

function makeParticipant(
  key: string,
  world: World,
  sharedOrder: string[],
  options: {
    policy?: (type: string) => SceneCommandPolicy;
  } = {},
): ParticipantHarness {
  const events: TestEvent[] = [];
  const batches: SceneContactBatch[] = [];
  const applied: SceneCommandEnvelope[] = [];
  const harness: ParticipantHarness = {
    participant: null as unknown as ParticipantHarness['participant'],
    stepOrder: sharedOrder,
    batches,
    applied,
    boom: false,
    eventsPerStep: 0,
  };
  const participant = {
    participantKey: key,
    revision: 1,
    physicsWorld: world,
    fixedDt: 1 / 60,
    substeps: 4,
    dispose() {},
    attachSceneOwner() {},
    detachSceneOwner() {},
    sceneCommandPolicy: options.policy,
    applySceneCommand(_owner: object, command: SceneCommandEnvelope) {
      applied.push(command);
    },
    sceneFixedStep(_owner: object, batch: SceneContactBatch) {
      sharedOrder.push(key);
      if (harness.boom) throw new Error(`fault:${key}`);
      batches.push(batch);
      for (let i = 0; i < harness.eventsPerStep; i++) {
        events.push({ kind: 'tick', n: i });
      }
    },
    finishSceneFrame() {},
    drainSceneEvents() {
      return events.splice(0);
    },
    sceneReset() {},
    sceneResetClock() {},
  };
  harness.participant = participant;
  return harness;
}

function overlapWorld(b3: Box3D): World {
  const world = b3.createWorld({ gravity: [0, 0, 0], enableSleep: false });
  const ground = world.createBody({ type: 'static', position: [0, 0, 0] });
  world.addBox(ground, [1, 1, 1]);
  const mover = world.createBody({ type: 'dynamic', position: [0.5, 0, 0] });
  world.addBox(mover, [1, 1, 1], { density: 1 });
  return world;
}

describe('createSceneRuntime', () => {
  let b3: Box3D;
  let world: World;
  let runtime: SceneRuntime<TestEvent> | undefined;

  beforeEach(async () => {
    b3 = await freshBox3D();
    world = b3.createWorld({ gravity: [0, 0, 0], enableSleep: false });
  });

  afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
    b3.dispose();
  });

  it('accepts any finite positive fixedDt and integer substeps >= 1', () => {
    const custom = createSceneRuntime({
      world,
      fixedDt: 1 / 120,
      substeps: 2,
      maxStepsPerFrame: 1,
    });
    expect(custom.stepper.fixedDt).toBeCloseTo(1 / 120);
    expect(custom.stepper.substeps).toBe(2);
    custom.dispose();
    expect(() => createSceneRuntime({ world, fixedDt: 0 })).toThrow(RangeError);
    expect(() => createSceneRuntime({ world, fixedDt: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => createSceneRuntime({ world, substeps: 0 })).toThrow(RangeError);
    expect(() => createSceneRuntime({ world, substeps: 1.5 })).toThrow(RangeError);
  });

  it('fans out a fixed step to two participants in participantKey order', () => {
    const order: string[] = [];
    const z = makeParticipant('z-part', world, order);
    const a = makeParticipant('a-part', world, order);
    runtime = createSceneRuntime({ world, maxStepsPerFrame: 1 });
    runtime.attach(z.participant);
    runtime.attach(a.participant);

    expect(runtime.advance(1 / 60)).toBe(1);
    expect(order).toEqual(['a-part', 'z-part']);
    expect(a.batches).toHaveLength(1);
    expect(z.batches).toHaveLength(1);
    expect(a.batches[0]).toBe(z.batches[0]);
    expect(Object.isFrozen(a.batches[0])).toBe(true);
  });

  it('stamps commands with the current epoch and rejects a stale revision', () => {
    const order: string[] = [];
    const a = makeParticipant('a-part', world, order, {
      policy: (type) => (type === 'nudge' ? 'coalescible' : 'critical'),
    });
    runtime = createSceneRuntime({ world, maxStepsPerFrame: 1 });
    runtime.attach(a.participant);

    const first = runtime.enqueueCommand({
      targetParticipantKey: 'a-part',
      type: 'fire',
      payload: { n: 1 },
    });
    expect(first.sceneEpoch).toBe(0);
    expect(first.targetRevision).toBe(1);
    expect(first.fixedStepIndex).toBe(1);

    runtime.reset();
    expect(runtime.advance(1 / 60)).toBe(1);
    expect(a.applied).toEqual([]);

    const second = runtime.enqueueCommand({
      targetParticipantKey: 'a-part',
      type: 'fire',
      payload: { n: 2 },
    });
    expect(second.sceneEpoch).toBe(1);

    a.participant.revision = 2;
    expect(() => runtime!.advance(1 / 60)).toThrow(/stale command revision for a-part/);
    expect(a.applied).toEqual([]);
    expect(runtime.telemetry().rejected).toBe(1);
    expect(runtime.telemetry().faulted).toBe(true);
  });

  it('drops coalescible commands under pressure and retains critical ones', () => {
    const order: string[] = [];
    const a = makeParticipant('a-part', world, order, {
      policy: (type) => (type === 'nudge' ? 'coalescible' : 'critical'),
    });
    runtime = createSceneRuntime({
      world,
      commandCapacity: 2,
      maxStepsPerFrame: 1,
    });
    runtime.attach(a.participant);

    const firstNudge = runtime.enqueueCommand({
      targetParticipantKey: 'a-part',
      type: 'nudge',
      payload: { n: 1 },
    });
    const coalesced = runtime.enqueueCommand({
      targetParticipantKey: 'a-part',
      type: 'nudge',
      payload: { n: 2 },
    });
    expect(coalesced.sequence).toBe(firstNudge.sequence);
    expect(coalesced.payload).toEqual({ n: 2 });
    expect(runtime.telemetry()).toMatchObject({ queued: 1, coalesced: 1, dropped: 0 });

    runtime.enqueueCommand({
      targetParticipantKey: 'a-part',
      type: 'fire',
      payload: { n: 1 },
    });
    runtime.enqueueCommand({
      targetParticipantKey: 'a-part',
      type: 'fire',
      payload: { n: 2 },
    });
    expect(runtime.telemetry()).toMatchObject({ queued: 3, dropped: 1, rejected: 0 });

    expect(() =>
      runtime!.enqueueCommand({
        targetParticipantKey: 'a-part',
        type: 'fire',
        payload: { n: 3 },
      }),
    ).toThrow(/command queue is full/);
    expect(runtime.telemetry()).toMatchObject({ queued: 3, dropped: 1, rejected: 1 });

    expect(runtime.advance(1 / 60)).toBe(1);
    expect(a.applied.map((c) => c.type)).toEqual(['fire', 'fire']);
    expect(a.applied.map((c) => (c.payload as { n: number }).n)).toEqual([1, 2]);
  });

  it('quarantines a participant fault, latches faulted, and recovers on reset', () => {
    const order: string[] = [];
    const a = makeParticipant('a-part', world, order);
    const z = makeParticipant('z-part', world, order);
    runtime = createSceneRuntime({ world, maxStepsPerFrame: 1 });
    runtime.attach(a.participant);
    runtime.attach(z.participant);

    a.boom = true;
    expect(() => runtime!.advance(1 / 60)).toThrow(/fault:a-part/);
    expect(runtime.telemetry().faulted).toBe(true);
    expect(runtime.telemetry().faults).toBeGreaterThanOrEqual(1);
    expect(order).toEqual(['a-part', 'z-part']);

    expect(() => runtime!.advance(1 / 60)).toThrow(
      /scene runtime is faulted; call reset\(\)/,
    );
    expect(() =>
      runtime!.enqueueCommand({
        targetParticipantKey: 'a-part',
        type: 'fire',
        payload: {},
      }),
    ).toThrow(/scene runtime is faulted; call reset\(\)/);

    a.boom = false;
    runtime.reset();
    expect(runtime.telemetry().faulted).toBe(false);
    order.length = 0;
    expect(runtime.advance(1 / 60)).toBe(1);
    expect(order).toEqual(['a-part', 'z-part']);
  });

  it('drops events from the bounded ring and accounts for them', () => {
    const order: string[] = [];
    const a = makeParticipant('a-part', world, order);
    const z = makeParticipant('z-part', world, order);
    a.eventsPerStep = 3;
    runtime = createSceneRuntime({
      world,
      eventCapacity: 2,
      maxStepsPerFrame: 1,
    });
    runtime.attach(a.participant);
    runtime.attach(z.participant);

    expect(runtime.advance(1 / 60)).toBe(1);
    expect(runtime.telemetry()).toMatchObject({
      retained: 2,
      droppedEvents: 1,
    });
    const drained = runtime.drainEvents();
    expect(drained).toHaveLength(2);
    expect(drained.every((e) => e.participantKey === 'a-part')).toBe(true);
    expect(Object.isFrozen(drained)).toBe(true);
    expect(runtime.telemetry().retained).toBe(0);
    expect(runtime.drainEvents()).toEqual([]);
  });

  it('reset barrier: undrained contacts are not interpreted on the next tick', () => {
    runtime?.dispose();
    const contactWorld = overlapWorld(b3);
    world = contactWorld;

    const staleBegins: { bodyA: number; bodyB: number; indexA: number; indexB: number }[] =
      [];
    let beginDrainCalls = 0;
    let endDrainCalls = 0;
    let hitDrainCalls = 0;
    const originalBegin = contactWorld.drainContactBeginEventsWithShapes.bind(contactWorld);
    const originalEnd = contactWorld.drainContactEndEventsWithShapes.bind(contactWorld);
    const originalHit = contactWorld.drainContactHitEventsWithShapes.bind(contactWorld);
    const mutable = contactWorld as unknown as {
      drainContactBeginEventsWithShapes: typeof originalBegin;
      drainContactEndEventsWithShapes: typeof originalEnd;
      drainContactHitEventsWithShapes: typeof originalHit;
    };
    mutable.drainContactBeginEventsWithShapes = () => {
      beginDrainCalls += 1;
      const events = originalBegin();
      for (const e of events) {
        staleBegins.push({
          bodyA: e.bodyA as number,
          bodyB: e.bodyB as number,
          indexA: e.shapeA.index1,
          indexB: e.shapeB.index1,
        });
      }
      return events;
    };
    mutable.drainContactEndEventsWithShapes = () => {
      endDrainCalls += 1;
      return originalEnd();
    };
    mutable.drainContactHitEventsWithShapes = () => {
      hitDrainCalls += 1;
      return originalHit();
    };

    const order: string[] = [];
    const a = makeParticipant('a-part', contactWorld, order);
    const z = makeParticipant('z-part', contactWorld, order);
    runtime = createSceneRuntime({
      world: contactWorld,
      maxStepsPerFrame: 1,
      classifyContact: () => 'unrouted',
    });
    runtime.attach(a.participant);
    runtime.attach(z.participant);

    contactWorld.step(1 / 60, 4);
    const beginsBeforeReset = beginDrainCalls;
    expect(beginsBeforeReset).toBe(0);

    runtime.reset();
    expect(beginDrainCalls).toBeGreaterThanOrEqual(1);
    expect(endDrainCalls).toBeGreaterThanOrEqual(1);
    expect(hitDrainCalls).toBeGreaterThanOrEqual(1);
    expect(staleBegins.length).toBeGreaterThan(0);
    expect(originalBegin()).toEqual([]);
    expect(originalEnd()).toEqual([]);
    expect(originalHit()).toEqual([]);

    const staleKey = new Set(
      staleBegins.map((e) => `${e.bodyA}:${e.bodyB}:${e.indexA}:${e.indexB}`),
    );
    staleBegins.length = 0;
    beginDrainCalls = 0;

    expect(runtime.advance(1 / 60)).toBe(1);
    const nextBegins = [...a.batches.at(-1)!.begins, ...z.batches.at(-1)!.begins];
    for (const e of nextBegins) {
      const key = `${e.bodyA as number}:${e.bodyB as number}:${e.shapeA.index1}:${e.shapeB.index1}`;
      expect(staleKey.has(key)).toBe(false);
    }
    expect(runtime.telemetry().unroutedContacts).toBeGreaterThanOrEqual(0);
  });

  it('counts unrouted contacts via classifyContact without reading addresses', () => {
    runtime?.dispose();
    const contactWorld = overlapWorld(b3);
    const order: string[] = [];
    const a = makeParticipant('a-part', contactWorld, order);
    const z = makeParticipant('z-part', contactWorld, order);
    runtime = createSceneRuntime({
      world: contactWorld,
      maxStepsPerFrame: 1,
      classifyContact: (begin) => (begin.approachSpeed === 0 ? 'unrouted' : 'routed'),
    });
    runtime.attach(a.participant);
    runtime.attach(z.participant);
    expect(runtime.advance(1 / 60)).toBe(1);
    expect(a.batches[0]!.begins.length).toBeGreaterThan(0);
    expect(runtime.telemetry().unroutedContacts).toBeGreaterThan(0);
  });
});
