#!/usr/bin/env node
// Copy the built WASM artifact from native/dist into this package's wasm/ dir,
// then SHA-check the copy against the source so a stale/partial copy is caught.
//
// The WASM is a prebuilt, committed artifact (see native/scripts/build-wasm.sh).
// This package ships its OWN copy under wasm/ so `npm publish` never reaches up
// into the monorepo's native/ tree (which is not part of the published files).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const repoRoot = resolve(pkgRoot, '..', '..');

const src = resolve(repoRoot, 'native', 'dist', 'box3d.wasm');
const dst = resolve(pkgRoot, 'wasm', 'box3d.wasm');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

mkdirSync(dirname(dst), { recursive: true });

const srcSha = sha256(src);
copyFileSync(src, dst);
const dstSha = sha256(dst);

if (srcSha !== dstSha) {
  console.error(`sync-wasm: SHA mismatch after copy!\n  src ${srcSha}\n  dst ${dstSha}`);
  process.exit(1);
}

console.log(`sync-wasm: copied box3d.wasm (sha256=${srcSha})`);
console.log(`  ${src}\n  -> ${dst}`);
