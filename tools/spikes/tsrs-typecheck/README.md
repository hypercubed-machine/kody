# Spike: tsrs for Kody package typecheck (research, no ship)

Kent asked whether Cloudflare/VoidZero's Rust TypeScript port (`tsrs`, npm
`tsrs` / `@tsrs/wasm`) could replace or supplement the TypeScript
language-service typecheck Kody runs in throwaway `REPO_SESSION` Durable Objects
(`packages/worker/src/repo/isolated-check-phases.ts`).

**This directory is a research spike only.** It is not wired into publish or
`kody dev check`. Do not merge as a product change. Do not run
`wrangler deploy`.

## Findings (measured vs inferred)

See the draft PR description and `results/` after running the scripts below.
Keep measured numbers separate from recommendations.

## What exists today

| Artifact              | Evidence                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Native CLI / Node API | npm `tsrs@0.20.0-ts7.1.0-beta` (Apache-2.0), optional native binaries `@tsrs/*`                                 |
| WebAssembly build     | npm `@tsrs/wasm@0.20.0-ts7.1.0-beta`, `tsrs.wasm` ~9.5 MiB raw (~2.9 MiB gzip -9)                               |
| In-memory VFS         | `tsc(args, { files, diagnostics: "json" })` and `memoryFileSystem` in `@tsrs/wasm/core`                         |
| Workers host          | Browser entry ships a small WASI preview1 shim + `tsrs_host` FS bridge (no `@cloudflare/workers-wasi` required) |
| License               | Apache-2.0 (derivative of TypeScript)                                                                           |

## Run (local)

```bash
# From repo root (Node >=22 for @tsrs/wasm; repo prefers Node 26)
npm install --prefix tools/spikes/tsrs-typecheck
npm run bench:node --prefix tools/spikes/tsrs-typecheck
npm run worker:probe --prefix tools/spikes/tsrs-typecheck
```

`bench:node` compares:

1. `@cloudflare/worker-bundler/typescript` `createTypescriptLanguageService`
   (same family as `runPackageTypecheckLanguageService`)
2. `@tsrs/wasm` in-memory `--noEmit` over the same fixture file maps

`worker:probe` starts **local** wrangler/workerd only and POSTs a tiny package
through `/typecheck`.

## Fixtures

Synthetic only (`fixtures/build-fixtures.mjs`). Trees are written under
`/tmp/kody-tsrs-typecheck-fixtures` (override with `TSRS_SPIKE_FIXTURE_ROOT`) so
intentional type errors are not picked up by repo `tools` typecheck.

- **small**: one callable + `kody:runtime` stub + intentional error
- **medium**: ~20 modules, jobs, zod type stub, intentional error
- **large**: ~180 domain modules across 10 groups + 8 jobs + intentional error
