import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const BODY_COUNTS = [100, 500, 1000, 2000];
const WARMUP_STEPS = 30;
const ACTIVE_STEPS = 300;
const SETTLE_STEPS = 180;
const IDLE_STEPS = 300;
const RESULTS_DIR = new URL('./results/', import.meta.url);
const BASELINE_JSON = new URL('./results/baseline.json', import.meta.url);
const CORE_ENTRY = new URL('../packages/core/dist/index.js', import.meta.url);
const WASM_URL = new URL('../packages/core/wasm/box3d.wasm', import.meta.url);

if (!existsSync(fileURLToPath(CORE_ENTRY))) {
  console.error(
    'benchmarks: packages/core/dist/index.js does not exist. Run `npm run build` first.',
  );
  process.exit(1);
}

const { createBox3D, FixedStepper, TransformBuffer, SleepManager } = await import(
  CORE_ENTRY.href
);

function progress(bodies, phase) {
  const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(`running N=${bodies} phase=${phase} elapsed=${elapsed}s`);
}

function stats(samples) {
  if (samples.length === 0) {
    return { mean: 0, median: 0, p95: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return { mean, median, p95 };
}

function round5(value) {
  return Number(value.toFixed(5));
}

function roundStats(value) {
  return {
    mean: round5(value.mean),
    median: round5(value.median),
    p95: round5(value.p95),
  };
}

// NOTE: the current bridge does not plumb `enableSleep:false` (sleep is always
// on in the native world). So the honest comparison here is SleepManager
// discipline vs box3d's own auto-sleep — NOT sleep vs no-sleep.
function createScene(box3d, bodies) {
  const world = box3d.createWorld({ gravity: [0, -9.81, 0] });
  const ground = world.createBody({ type: 'static', position: [0, -0.5, 0] });
  world.addBox(ground, [60, 0.5, 60], { friction: 0.9 });

  const dynamicBodies = [];
  const buffer = new TransformBuffer(bodies);
  const columns = Math.ceil(Math.cbrt(bodies));
  const spacing = 0.62;
  const halfSpan = ((columns - 1) * spacing) / 2;

  for (let i = 0; i < bodies; i += 1) {
    const x = (i % columns) * spacing - halfSpan;
    const z = (Math.floor(i / columns) % columns) * spacing - halfSpan;
    const y = 1.5 + Math.floor(i / (columns * columns)) * spacing;
    const body = world.createBody({ type: 'dynamic', position: [x, y, z] });
    world.addBox(body, [0.25, 0.25, 0.25], { density: 2, friction: 0.7 });
    dynamicBodies.push(body);
    buffer.add(body);
  }

  buffer.rebuild();
  return { world, dynamicBodies, buffer };
}

function stepWorld(world, stepper) {
  const started = process.hrtime.bigint();
  world.step(stepper.fixedDt, stepper.substeps);
  const ended = process.hrtime.bigint();
  return Number(ended - started) / 1_000_000;
}

function runSteps(world, stepper, buffer, count) {
  for (let i = 0; i < count; i += 1) {
    stepWorld(world, stepper);
    buffer.readInto(world);
  }
}

function measureSteps(world, stepper, buffer, count, afterStep) {
  const samples = [];

  for (let i = 0; i < count; i += 1) {
    const ms = stepWorld(world, stepper);
    buffer.readInto(world);
    if (afterStep) afterStep();
    samples.push(ms);
  }

  return stats(samples);
}

function runSleepSettling(world, stepper, buffer, dynamicBodies) {
  const sleep = new SleepManager(world, {
    settleSteps: SETTLE_STEPS - 1,
    sweepIntervalSec: 0.5,
  });
  sleep.watch(dynamicBodies, buffer);

  let simTime = 0;
  for (let i = 0; i < SETTLE_STEPS; i += 1) {
    stepWorld(world, stepper);
    simTime += stepper.fixedDt;
    buffer.readInto(world);
    sleep.forceSleepSettled();
    sleep.sweep(simTime);
  }

  return {
    measureIdle(count) {
      return measureSteps(world, stepper, buffer, count, () => {
        simTime += stepper.fixedDt;
        sleep.forceSleepSettled();
        sleep.sweep(simTime);
      });
    },
  };
}

function measureActiveAndIdleSleep(box3d, bodies) {
  const stepper = new FixedStepper();
  const { world, dynamicBodies, buffer } = createScene(box3d, bodies);

  try {
    progress(bodies, 'warmup');
    runSteps(world, stepper, buffer, WARMUP_STEPS);

    progress(bodies, 'active');
    const active = measureSteps(world, stepper, buffer, ACTIVE_STEPS);

    progress(bodies, 'settle-sleep');
    const sleepSettling = runSleepSettling(world, stepper, buffer, dynamicBodies);

    progress(bodies, 'idle-sleep');
    const idleSleepManager = sleepSettling.measureIdle(IDLE_STEPS);
    const awake = world.awakeBodyCount();

    return { active, idleSleepManager: { ...idleSleepManager, awake } };
  } finally {
    world.destroy();
  }
}

// Idle WITHOUT the SleepManager: box3d's built-in auto-sleep only. (The bridge
// cannot disable sleep entirely, so this is the honest baseline the
// SleepManager discipline is compared against.)
function measureIdleAutoSleep(box3d, bodies) {
  const stepper = new FixedStepper();
  const { world, buffer } = createScene(box3d, bodies);

  try {
    progress(bodies, 'warmup-auto-sleep');
    runSteps(world, stepper, buffer, WARMUP_STEPS);

    progress(bodies, 'settle-auto-sleep');
    runSteps(world, stepper, buffer, ACTIVE_STEPS + SETTLE_STEPS);

    progress(bodies, 'idle-auto-sleep');
    const idleAutoSleep = measureSteps(world, stepper, buffer, IDLE_STEPS);
    const awake = world.awakeBodyCount();

    return { ...idleAutoSleep, awake };
  } finally {
    world.destroy();
  }
}

function formatMs(value) {
  return value.toFixed(4).padStart(14);
}

function printTable(results) {
  const headers = [
    'bodies',
    'active mean ms',
    'active p95 ms',
    'idle(mgr) mean ms',
    'idle(auto) mean ms',
    'awake@idle',
  ];
  const widths = [8, 16, 15, 20, 23, 11];
  const line = widths.map((width) => '-'.repeat(width)).join('  ');

  console.log('');
  console.log(headers.map((header, i) => header.padStart(widths[i])).join('  '));
  console.log(line);

  for (const result of results) {
    console.log(
      [
        String(result.bodies).padStart(widths[0]),
        formatMs(result.active.mean).padStart(widths[1]),
        formatMs(result.active.p95).padStart(widths[2]),
        formatMs(result.idleSleepManager.mean).padStart(widths[3]),
        formatMs(result.idleAutoSleep.mean).padStart(widths[4]),
        String(result.idleSleepManager.awake).padStart(widths[5]),
      ].join('  '),
    );
  }
}

async function writeBaseline(results) {
  const cpu = os.cpus()[0];
  const baseline = {
    generatedAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      cpus: cpu ? cpu.model : 'unknown',
      nodeVersion: process.version,
    },
    note:
      'single-machine, single-thread, native node; absolute numbers are machine-specific — compare deltas not absolutes. idleSleepManager = idle with the SleepManager discipline; idleAutoSleep = idle with box3d built-in auto-sleep only (the bridge cannot disable sleep entirely).',
    results: results.map((result) => ({
      bodies: result.bodies,
      active: roundStats(result.active),
      idleSleepManager: {
        ...roundStats(result.idleSleepManager),
        awake: result.idleSleepManager.awake,
      },
      idleAutoSleep: {
        ...roundStats(result.idleAutoSleep),
        awake: result.idleAutoSleep.awake,
      },
    })),
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(BASELINE_JSON, `${JSON.stringify(baseline, null, 2)}\n`);
}

const startedAt = performance.now();
const box3d = await createBox3D({ wasmUrl: WASM_URL });
const results = [];

try {
  for (const bodies of BODY_COUNTS) {
    const { active, idleSleepManager } = measureActiveAndIdleSleep(box3d, bodies);
    const idleAutoSleep = measureIdleAutoSleep(box3d, bodies);
    results.push({ bodies, active, idleSleepManager, idleAutoSleep });
  }
} finally {
  box3d.dispose();
}

printTable(results);
await writeBaseline(results);
console.log(`\nwrote ${fileURLToPath(BASELINE_JSON)}`);
