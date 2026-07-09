# Bundler notes

`box3d-web` ships a WebAssembly binary. How that binary reaches the browser depends on which build you import and how your bundler is configured. Two things trip people up: **the WASM asset** and **top-level `await`**.

## Two builds: `compat` vs `separate`

The core exposes the same `createBox3D()` from two entry points with different WASM packaging:

```ts
import { createBox3D } from 'box3d-web';          // compat — WASM base64-inlined (default)
import { createBox3D } from 'box3d-web/separate';  // separate .wasm asset (smaller, async)
```

| | `box3d-web` (compat) | `box3d-web/separate` |
|---|---|---|
| WASM delivery | base64-inlined into the JS | separate `.wasm` asset fetched at init |
| Bundler config | none — works everywhere | may need asset handling (below) |
| Bundle size | larger (base64 ≈ +33%) | smaller JS, cached `.wasm` |
| Best for | the safe default; beginners; SSR/edge | production apps that want a cacheable asset |

**Start with the default `compat` import.** It has no bundler requirements — the WASM travels inside the JS. Move to `/separate` once you want the smaller, separately-cacheable asset and are ready to make sure your bundler emits the `.wasm` file.

## The WASM asset (`separate` build)

The `separate` loader resolves the binary with `new URL('box3d.wasm', import.meta.url)`. Modern bundlers understand this pattern and will emit the `.wasm` as an asset automatically:

- **Vite** — works out of the box; the `.wasm` is fingerprinted and copied into `dist/assets`. No config needed.
- **webpack 5** — `new URL(..., import.meta.url)` is supported natively via asset modules. If you have a custom `module.rules` for `.wasm`, make sure it uses `type: 'asset/resource'`, not the deprecated `experiments.asyncWebAssembly` loader path.
- **Rollup** — with `@rollup/plugin-url` or the Vite pipeline, the asset is emitted. Plain Rollup without an asset plugin will not copy it.
- **esbuild** — set `loader: { '.wasm': 'file' }` so the binary is emitted alongside the bundle.

If your setup can't emit the asset, override the location explicitly:

```ts
import wasmUrl from 'box3d-web/wasm/box3d.wasm?url'; // Vite: gets a served URL
const b3 = await createBox3D({ wasmUrl });
```

Or hand the loader the bytes directly (Node, a custom fetch, or a cache):

```ts
const b3 = await createBox3D({ wasmBinary: myArrayBuffer });
```

`wasmBinary` takes precedence over `wasmUrl`, which takes precedence over the built-in `locateFile`.

## Top-level `await` needs `es2022`

Every quickstart leads with `await createBox3D()` — often at module top level. Top-level await is an ES2022 feature, and several bundlers default to an older target that rejects it with a parse error like *"Top-level await is not available in the configured target environment."*

Set the target to `es2022` (or later):

::: code-group

```ts [vite.config.ts]
export default defineConfig({
  build: { target: 'es2022' },
  // dev server (esbuild) also needs it:
  esbuild: { target: 'es2022' },
});
```

```js [esbuild]
esbuild.build({
  target: 'es2022',
  format: 'esm',
});
```

```json [tsconfig.json]
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext"
  }
}
```

:::

If you'd rather not touch the target, wrap the init in an async function and call it from your entry point instead of awaiting at module scope — but the `es2022` target is the cleaner fix and matches what the examples in this repo use.

## Environments

The loader supports **browser**, **web worker**, and **Node** loading paths. In a worker the physics runs on the worker thread that created the instance; cross-thread transfer of buffers or handles is out of scope for v0.1. In Node (tests, benchmarks, SSR pre-warm) pass the bytes via `wasmBinary` or a `file://` `wasmUrl`.

Multithread / SharedArrayBuffer builds — with their COOP/COEP header requirements — are deliberately **out of scope until post-1.0**.
