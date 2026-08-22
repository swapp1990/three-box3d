/**
 * applyArticulatedPose — checked group teleport for jointed bodies.
 *
 * Moving only some bodies of a chain/crane/ragdoll can separate a joint's two
 * local anchors; the solver then starts from an impossible pose. This helper
 * validates, applies every transform as one group, measures spherical/revolute
 * world-space anchor separation, and rolls the whole group back if any joint
 * exceeds the tolerance.
 */
import type { BodyHandle, JointHandle, Quat, Vec3 } from '../types.js';

export interface ArticulatedPose {
  body: BodyHandle;
  position: Vec3;
  rotation: Quat;
}

export interface ArticulatedPoseMeasurement {
  joint: JointHandle;
  separation: number;
}

export interface ArticulatedPoseOptions {
  joints?: readonly JointHandle[];
  /** Maximum allowed world-space anchor separation. Default `1e-3`. */
  maxJointAnchorSeparation?: number;
  /** Zero linear and angular velocity after a successful pose. Default `true`. */
  clearVelocities?: boolean;
  /** Put every posed body to sleep after a successful pose. Default `false`. */
  sleep?: boolean;
}

export interface ArticulatedPoseResult {
  separations: ArticulatedPoseMeasurement[];
  maxSeparation: number;
}

interface WorldLike {
  getJointAnchorSeparation(joint: JointHandle): number;
  readTransforms(ids: Int32Array, out: Float32Array): Float32Array;
  isBodyAwake(body: BodyHandle): boolean;
  setBodyTransform(body: BodyHandle, position: Vec3, rotation: Quat): void;
  setAwake(body: BodyHandle, awake: boolean): void;
  setLinearVelocity(body: BodyHandle, v: Vec3): void;
  setAngularVelocity(body: BodyHandle, w: Vec3): void;
  sleepBody(body: BodyHandle): void;
}

export class ArticulatedPoseError extends Error {
  name = 'ArticulatedPoseError';
  readonly measurements: ArticulatedPoseMeasurement[];
  readonly maxJointAnchorSeparation: number;

  constructor(
    message: string,
    measurements: ArticulatedPoseMeasurement[],
    maxJointAnchorSeparation: number,
  ) {
    super(message);
    this.measurements = measurements;
    this.maxJointAnchorSeparation = maxJointAnchorSeparation;
  }
}

function finiteTuple(values: readonly number[], length: number): boolean {
  return values.length === length && values.every((value) => Number.isFinite(value));
}

function validatePoseInput(poses: readonly ArticulatedPose[]): void {
  const seen = new Set<number>();
  for (const pose of poses) {
    if (!pose || !Number.isInteger(pose.body) || pose.body <= 0) {
      throw new TypeError('box3d-web: articulated pose body handles must be positive integers.');
    }
    if (seen.has(pose.body)) {
      throw new RangeError(`box3d-web: articulated pose contains duplicate body ${pose.body}.`);
    }
    seen.add(pose.body);
    if (!finiteTuple(pose.position, 3) || !finiteTuple(pose.rotation, 4)) {
      throw new TypeError('box3d-web: articulated pose transforms must contain finite tuples.');
    }
    const [qx, qy, qz, qw] = pose.rotation;
    if (qx * qx + qy * qy + qz * qz + qw * qw <= 1e-12) {
      throw new RangeError('box3d-web: articulated pose rotations must be non-zero quaternions.');
    }
  }
}

function validateJoints(joints: readonly JointHandle[]): void {
  const seen = new Set<number>();
  for (const joint of joints) {
    if (!Number.isInteger(joint) || joint <= 0) {
      throw new TypeError('box3d-web: articulated pose joint handles must be positive integers.');
    }
    if (seen.has(joint)) {
      throw new RangeError(`box3d-web: articulated pose contains duplicate joint ${joint}.`);
    }
    seen.add(joint);
  }
}

export function applyArticulatedPose(
  world: WorldLike,
  poses: readonly ArticulatedPose[],
  options: ArticulatedPoseOptions = {},
): ArticulatedPoseResult {
  if (!Array.isArray(poses)) {
    throw new TypeError('box3d-web: articulated poses must be an array.');
  }
  validatePoseInput(poses);
  const joints = options.joints ?? [];
  if (!Array.isArray(joints)) {
    throw new TypeError('box3d-web: articulated pose joints must be an array.');
  }
  validateJoints(joints);
  const maxAllowed = options.maxJointAnchorSeparation ?? 1e-3;
  if (!Number.isFinite(maxAllowed) || maxAllowed < 0) {
    throw new RangeError('box3d-web: maxJointAnchorSeparation must be finite and non-negative.');
  }
  for (const joint of joints) world.getJointAnchorSeparation(joint);
  const ids = new Int32Array(poses.map((pose) => pose.body));
  const originalTransforms = new Float32Array(poses.length * 7);
  world.readTransforms(ids, originalTransforms);
  const originalAwake = poses.map((pose) => world.isBodyAwake(pose.body));
  for (let i = 0; i < poses.length; i++) {
    const offset = i * 7;
    if (
      !Number.isFinite(originalTransforms[offset]) ||
      !Number.isFinite(originalTransforms[offset + 1]) ||
      !Number.isFinite(originalTransforms[offset + 2])
    ) {
      throw new RangeError(`box3d-web: articulated pose body ${poses[i].body} is not live.`);
    }
  }
  const rollback = (): void => {
    for (let i = 0; i < poses.length; i++) {
      const offset = i * 7;
      world.setBodyTransform(
        poses[i].body,
        [originalTransforms[offset], originalTransforms[offset + 1], originalTransforms[offset + 2]],
        [
          originalTransforms[offset + 3],
          originalTransforms[offset + 4],
          originalTransforms[offset + 5],
          originalTransforms[offset + 6],
        ],
      );
    }
    for (let i = 0; i < poses.length; i++) {
      world.setAwake(poses[i].body, originalAwake[i]);
    }
  };
  try {
    for (const pose of poses) world.setBodyTransform(pose.body, pose.position, pose.rotation);
    const separations = joints.map((joint) => ({
      joint,
      separation: world.getJointAnchorSeparation(joint),
    }));
    const maxSeparation = separations.reduce(
      (max, measurement) => Math.max(max, measurement.separation),
      0,
    );
    if (maxSeparation > maxAllowed) {
      rollback();
      throw new ArticulatedPoseError(
        `box3d-web: articulated pose exceeds max joint-anchor separation (${maxSeparation} > ${maxAllowed}).`,
        separations,
        maxAllowed,
      );
    }
    if (options.clearVelocities ?? true) {
      for (const pose of poses) {
        world.setLinearVelocity(pose.body, [0, 0, 0]);
        world.setAngularVelocity(pose.body, [0, 0, 0]);
      }
    }
    if (options.sleep) {
      for (const pose of poses) world.sleepBody(pose.body);
    }
    return { separations, maxSeparation };
  } catch (error) {
    if (error instanceof ArticulatedPoseError) throw error;
    rollback();
    throw error;
  }
}
