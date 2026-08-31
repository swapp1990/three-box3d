import { describe, expect, it } from 'vitest';
import type { BodyHandle, ShapeIdentity, World } from '../src/index.js';
import type {
  SceneCommandEnvelope,
  SceneCommandPolicy,
  SceneContactBatch,
  SceneParticipant,
} from '../src/helpers/index.js';

interface TestEvent {
  readonly kind: 'ping';
}

function commandPolicy(
  participant: SceneParticipant,
  type: string,
): SceneCommandPolicy {
  return participant.sceneCommandPolicy?.(type) ?? 'critical';
}

function fakeParticipant(): SceneParticipant<TestEvent> {
  const events: TestEvent[] = [];
  return {
    participantKey: 'structure:yard:g0:n0/world:yard:g0:n0',
    revision: 4,
    physicsWorld: {} as World,
    fixedDt: 1 / 60,
    substeps: 4,
    dispose() {},
    attachSceneOwner() {},
    detachSceneOwner() {},
    sceneCommandPolicy(type) {
      return type === 'nudge' ? 'coalescible' : 'critical';
    },
    applySceneCommand(_owner, command) {
      events.push({ kind: 'ping' });
      void command;
    },
    sceneFixedStep() {},
    finishSceneFrame() {},
    drainSceneEvents() {
      return events.splice(0);
    },
    sceneReset() {
      events.length = 0;
    },
    sceneResetClock() {},
  };
}

describe('SceneParticipant contract', () => {
  it('accepts a minimal participant and a renamed command envelope', () => {
    const participant: SceneParticipant<TestEvent> = fakeParticipant();
    const owner = {};
    participant.attachSceneOwner(owner);

    const batch: SceneContactBatch = { begins: [], ends: [], hits: [] };
    participant.sceneFixedStep(owner, batch);
    participant.finishSceneFrame(owner, 1 / 60, true);

    const command: SceneCommandEnvelope = {
      sequence: 1,
      sceneEpoch: 0,
      fixedStepIndex: 3,
      targetParticipantKey: participant.participantKey,
      targetRevision: participant.revision,
      type: 'unknown.command',
      payload: { ok: true },
    };
    expect(command.targetParticipantKey).toBe(participant.participantKey);
    participant.applySceneCommand(owner, command);

    const drained = participant.drainSceneEvents(owner);
    expect(drained).toEqual([{ kind: 'ping' }]);

    expect(commandPolicy(participant, 'unknown.command')).toBe('critical');
    expect(commandPolicy(participant, 'nudge')).toBe('coalescible');

    participant.sceneReset(owner);
    participant.sceneResetClock(owner);
    participant.detachSceneOwner(owner);
    participant.dispose();
  });

  it('treats missing sceneCommandPolicy as critical (scheduler default)', () => {
    const participant = fakeParticipant();
    delete (participant as { sceneCommandPolicy?: SceneParticipant['sceneCommandPolicy'] })
      .sceneCommandPolicy;
    expect(commandPolicy(participant, 'anything')).toBe('critical');
  });

  it('allows optional ownsBody / resolveShape', () => {
    const withBody: SceneParticipant = {
      ...fakeParticipant(),
      ownsBody: (body: BodyHandle) => (body as number) === 7,
      resolveShape: (identity: ShapeIdentity) => identity.index1 === 1,
    };
    expect(withBody.ownsBody?.(7 as BodyHandle)).toBe(true);
    expect(withBody.resolveShape?.({ index1: 1, world0: 0, generation: 1 })).toBe(true);
    expect(fakeParticipant().ownsBody).toBeUndefined();
  });
});
