# The fixed step

Physics must advance in **fixed-size time steps**, decoupled from your render frame rate, or the simulation is neither stable nor reproducible. Variable `dt` — feeding `world.step(delta)` the raw time since the last `requestAnimationFrame` — produces different results at different frame rates, jitters under load, and can explode outright on a long frame. `FixedStepper` is the accumulator that gets this right.

## The accumulator

`FixedStepper` accumulates real time and spends it in fixed increments (default `1/60` s, 4 solver substeps):

```ts
const stepper = new FixedStepper(); // 1/60, 4 substeps, death-spiral clamp

function frame(delta: number) {
  const stepped = stepper.advance(delta, (dt) => {
    world.step(dt);         // always called with the SAME fixed dt
    sleep.forceSleepSettled();
    sleep.sweep(stepper.simTime);
  });
  if (stepped) {
    buffer.rebuild();
    buffer.readInto(world);
    writeTransformsToInstancedMesh(mesh, buffer);
  }
}
```

`advance(delta, onStep)` runs `onStep` zero or more times — each time with the identical fixed `dt` — and returns how many steps ran. A return of `0` means no simulation advanced this frame, so there's nothing new to read or draw; skip the buffer read and the mesh write.

## The death-spiral guard

Here is the trap the guard exists for. Suppose the tab is backgrounded, or a GC pause stalls a frame for 800 ms. A naive accumulator now owes ~48 steps. Running all 48 in one frame takes longer than 800 ms of wall-clock, which makes the *next* frame's delta even bigger, which owes even more steps — the sim falls further behind every frame and never recovers. That's the **death spiral**.

`FixedStepper` guards against it two ways:

- **`maxDeltaClamp`** (default `0.1` s) clamps any single frame's delta before accumulating. A 5-second stall contributes at most 100 ms of debt.
- **`maxStepsPerFrame`** (default `3`) caps how many fixed steps run per frame. Excess backlog is dropped rather than chased. The sim runs slightly slow for a frame or two instead of spiraling.

The result is graceful degradation: a slow frame produces a small visible hitch, never a runaway that locks the tab.

```ts
new FixedStepper({
  fixedDt: 1 / 60,
  substeps: 4,
  maxDeltaClamp: 0.1,      // clamp a single frame's delta
  maxStepsPerFrame: 3,     // cap catch-up steps; drop the rest
});
```

## `simTime`

`stepper.simTime` is the total simulated time in seconds, monotone in fixed increments. Use it — not `performance.now()` — for anything that must line up with the simulation, like the `SleepManager` sweep cadence: `sleep.sweep(stepper.simTime)`.

## In React

`useFixedStep` wraps this for R3F, driving the accumulator from `useFrame`:

```ts
useFixedStep(world, {
  onStep: (dt, simTime) => { sleep.forceSleepSettled(); sleep.sweep(simTime); },
  onAfterFrame: (stepped) => { if (stepped > 0) { buffer.readInto(world); sync(); } },
});
```

`onStep` runs per fixed step (physics + sleep discipline); `onAfterFrame` runs once per rendered frame with the step count (read + sync). Neither calls `setState` — the whole point is to keep per-frame work off React's render path.
