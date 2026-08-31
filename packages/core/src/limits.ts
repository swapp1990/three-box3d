/**
 * Canonical native-limit constants for box3d-web.
 *
 * These match the engine/bridge defaults. Import them instead of duplicating
 * magic numbers in consumer code.
 */

/** Maximum native shape index. box3d `B3_SHAPE_POWER` = 22 (`1 << 22`). */
export const MAX_NATIVE_SHAPE_INDEX = 1 << 22;

/**
 * Maximum simultaneous bridge worlds.
 * Must match `B3BRIDGE_MAX_WORLDS` (default 128) in `native/bridge.c`.
 */
export const MAX_NATIVE_WORLDS = 128;

/** Maximum `ShapeIdentity.generation`. Native generation is a `uint16`. */
export const MAX_NATIVE_GENERATION = 0xffff;
