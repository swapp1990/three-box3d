# Island sleeping

A settled structure should cost almost nothing to simulate. box3d supports sleeping — putting idle bodies aside so the solver skips them — but the semantics have one sharp edge that catches everyone, and getting it right is the difference between a scene that idles at ~0 step cost and one whose step time balloons as it fills up.

## box3d sleeps *islands*, not bodies

This is the rule to internalize:

> **box3d sleeps islands, not individual bodies. A settled stacked structure is ONE island — waking any body wakes the whole thing.**

An "island" is a connected group of bodies that touch or are jointed together. A brick wall that has come to rest is a single island. If any one brick in that island is woken — by a raycast, an impulse, a stray contact — the **entire wall** wakes with it. Conversely, you can't sleep half a wall; sleep is island-granular.

The failure mode: you spawn a large structure, it *looks* settled, but nothing ever actually sleeps because there's always one body twitching by a millimetre. The whole island stays awake, the solver processes every body every step, and step time climbs with body count instead of staying flat. On a big scene this is the difference between 60 fps and a slideshow.

## The discipline: force-sleep + periodic sweep

`SleepManager` encodes the two-part discipline that keeps islands asleep:

```ts
const sleep = new SleepManager(world, {
  settleSteps: 2,          // let a fresh spawn settle this many steps first
  sweepIntervalSec: 2,     // then re-check for idle bodies this often
  moveThreshold: 0.01,     // "moving" = displaced more than this (m) since last sweep
});
sleep.watch(bricks, buffer);   // poses live in the shared TransformBuffer
```

1. **Force-sleep after spawn.** A freshly created stack jitters as it settles. Let it settle a couple of steps, then explicitly sleep it — don't wait for box3d's own heuristic, which may never trigger if one body keeps twitching.

   ```ts
   stepper.advance(delta, () => {
     world.step(dt);
     sleep.forceSleepSettled();   // sleeps tracked spawns once settled
     sleep.sweep(stepper.simTime);
   });
   ```

2. **Periodic sweep.** On a cadence, sample how far each tracked body moved. Bodies that moved less than `moveThreshold` over the interval get slept. This catches islands that drifted to rest after the initial settle — the ones box3d's own logic leaves awake.

`SleepManager` reads each body's pose via `buffer.offsetOf(body)` on **every** sweep — it never caches slot indices, because the `TransformBuffer` renumbers slots when a body is removed (see [Worlds, handles & buffers](./handles-and-buffers)). Hand it the same buffer you read transforms into; one buffer feeds sleep, `radialImpulse`, and the adapter.

## Waking things up

To disturb a settled island — an explosion, a click-impulse — you must **wake it first**. An impulse applied to a sleeping body wakes it (and its island) automatically. This is also why the explode workaround exists:

> **Native `b3World_Explode` is a NO-OP on sleeping bodies.**

The engine's built-in explode simply does nothing to a body that's asleep — which is exactly the body you want to blow up. So `three-box3d` ships [`radialImpulse`](../guide/gotchas#the-native-explode-no-op), which wakes each in-range body and applies a falloff impulse by hand. See the Gotchas page for the full story.

## Verifying it works

`world.awakeBodyCount()` returns how many bodies are in an awake island. Put it in your HUD. A correctly-sleeping brick wall reads `awake: 0` at rest and jumps to the island size the instant you hit it, then settles back to `0` a couple of seconds later. If it never returns to `0`, your `moveThreshold` is too tight or something is nudging the island every step.
