# Determinism

Determinism means: the same inputs produce the same outputs, bit for bit, every run. It matters for replays, lockstep networking, and reproducible tests. box3d is a deterministic C solver by design, but *how deterministic the WASM build is* depends on the compile flags and the execution environment — so it's important to state exactly what `three-box3d` claims, and what it does not.

## The v0.1 claim

> **Single-threaded, same-build reproducible; no cross-platform guarantee yet.**

Concretely, for v0.1:

- **Reproducible** across runs on the same machine, same browser, same WASM build: feed the same seed and the same sequence of steps, and you get an identical transform stream every time. The core's test suite includes a determinism test that asserts exactly this.
- **Single-threaded.** The sim runs on the one thread that created the instance. There is no multithread / SharedArrayBuffer build in v0.1 — thread scheduling is a classic source of non-determinism, and it's deliberately out of scope until post-1.0.
- **No cross-platform guarantee.** Two different machines, browsers, or CPU architectures may produce slightly different floating-point results. We do not promise identical streams across platforms in v0.1.

## Why the build flags matter

The WASM is compiled with two flags specifically to keep floating-point behavior stable:

```
-DBOX3D_DISABLE_SIMD    # no SIMD lanes — avoids width/order-dependent FP results
-ffp-contract=off       # no fused multiply-add contraction — a*b+c stays two ops
```

SIMD and FMA contraction both change the *order* and *rounding* of floating-point operations, which is enough to diverge two runs that should be identical. Disabling them trades a little raw throughput for reproducibility — the box3d/Emscripten anticipated path for a deterministic build, and the reason the v0.1 same-build claim holds.

## What's coming

The cross-run / cross-platform **determinism CI guarantee** is a v1.0 goal: a CI test that feeds identical input and asserts an identical transform stream across runs (and eventually platforms), matching Rapier's deterministic-build discipline. Until that test lands and stays green, treat determinism as the conservative v0.1 claim above — reliable within a build on a machine, not a cross-platform promise.

## Practical guidance

- For **replays or deterministic tests on one target**, you're covered today: pin the build, use the fixed step, feed the same inputs.
- For **lockstep multiplayer across clients**, wait for the v1.0 cross-platform guarantee, or verify divergence tolerance for your specific target set yourself.
- Always drive the sim through [`FixedStepper`](./fixed-step). Variable `dt` is non-deterministic regardless of the build — the fixed step is a prerequisite for any reproducibility claim.
