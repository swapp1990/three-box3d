/**
 * `box3d-web/helpers` — selective-import subpath for the tree-shakeable runtime
 * helpers. None imports three; each takes a `World` (or plain callbacks) as input.
 */
export { FixedStepper, type FixedStepperOptions, type FixedStepperTelemetry } from './fixed-step.js';
export { TransformBuffer } from './transform-buffer.js';
export { SleepManager, type SleepManagerOptions } from './sleep-manager.js';
export { radialImpulse, type RadialImpulseOptions } from './radial-impulse.js';
export { BodyPool } from './body-pool.js';
export {
  ArticulatedPoseError,
  applyArticulatedPose,
  type ArticulatedPose,
  type ArticulatedPoseMeasurement,
  type ArticulatedPoseOptions,
  type ArticulatedPoseResult,
} from './articulated-pose.js';
export {
  createIdentitySystem,
  sameIdentity,
  type Identity,
  type IdentityMintScope,
  type IdentityParentOf,
  type IdentityScope,
  type IdentitySystem,
} from './identity.js';
export type {
  SceneCommandEnvelope,
  SceneCommandPolicy,
  SceneContactBatch,
  SceneParticipant,
} from './scene-participant.js';
