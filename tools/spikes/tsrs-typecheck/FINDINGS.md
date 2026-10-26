# tsrs typecheck spike findings

Research only. Not a product change. Do not merge as a ship.

## 1. Wasm usable in Workers/DOs today?

**Measured**

| Fact                | Value / evidence                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tsrs/wasm` on npm | `0.20.0-ts7.1.0-beta` (Apache-2.0)                                                                                                                                                              |
| `tsrs.wasm` size    | 9,950,001 bytes raw (~9.49 MiB); gzip -9 ≈ 2.87 MiB                                                                                                                                             |
| API                 | `tsc(args, { files, diagnostics: "json", module })` over an in-memory map; `memoryFileSystem` in `@tsrs/wasm/core`                                                                              |
| Host                | Browser/`core.js` ships a small WASI preview1 shim + `tsrs_host` FS bridge (no real FS required)                                                                                                |
| Local workerd probe | `worker/probe.mjs` (`wrangler dev --local`): `/typecheck` returned HTTP 200, exitCode 2, 1 diagnostic, `memoryBytes` 101,842,944 (97.125 MiB), wall 75 ms                                       |
| Local memory limits | workerd does **not** enforce the production 128 MiB isolate cap ([workerd#49](https://github.com/cloudflare/workerd/issues/49); Cloudflare guidance: limits enforced on the network, not local) |

**Inferred (from measured + public docs)**

- Production Workers/DO isolates cap at **128 MiB** for JS heap **plus** Wasm
  allocations.
- `@tsrs/wasm` documents an **80 MiB shadow stack** inside linear memory on
  every instance. Tiny fixtures already report **~97–102 MiB** linear memory
  after one check.
- Upstream wasm-build notes report linear memory **134+ MiB** for small bench
  projects (Compiler), well above 128 MiB alone.
- Therefore: API shape fits Kody's in-memory VFS typecheck, but **production DO
  headroom is not there** for real packages until upstream shrinks the shadow
  stack / baseline memory. Local probe success is not production proof.

## 2. Prototype

Under `tools/spikes/tsrs-typecheck/`:

- Synthetic fixtures (small / medium / large) modeled on Kody package shapes
  (`kody:runtime` ambient, jobs, dep type stubs).
- `bench-node.mjs`: compare `@cloudflare/worker-bundler`
  `createTypescriptLanguageService` (TS **6.0.3**) vs `@tsrs/wasm` (TS
  **7.1.0-beta** port).
- `worker/`: local-only wrangler Worker that runs `@tsrs/wasm` (never deploy).

## 3. Benchmarks (Node, measured)

Environment: Cloud Agent Linux, Node v26.x. Medians of 3 interleaved rounds
(`--expose-gc`). RSS is process RSS (noisy); tsrs also reports Wasm linear
memory.

| Fixture | Files / bytes | LS wall ms | LS peak RSS MiB | tsrs wall ms | tsrs peak RSS MiB | tsrs linear MiB | LS diags | tsrs diags | Shared / only-LS / only-tsrs |
| ------- | ------------: | ---------: | --------------: | -----------: | ----------------: | --------------: | -------: | ---------: | ---------------------------- |
| small   |   4 / 1.1 KiB |       ~282 |            ~248 |          ~28 |              ~266 |        **97.3** |        1 |          1 | 1 / 0 / 0                    |
| medium  |   33 / 12 KiB |       ~293 |            ~334 |          ~35 |              ~348 |        **97.3** |        1 |          1 | 1 / 0 / 0                    |
| large   |  215 / 94 KiB |       ~440 |            ~386 |          ~58 |              ~394 |       **101.8** |        1 |          1 | 1 / 0 / 0                    |

Cold start (new Node process, median of 5): see `results/cold-start.json` after
`node bench-cold-start.mjs`.

Parity on these fixtures: same intentional `TS2322` (string not assignable to
number). Messages matched. Positions matched for the intentional error on
small/medium/large bug files under this harness. This does **not** prove
conformance against TS 6.0.3 broadly; engines differ (6.0.3 LS vs 7.1.0-beta
port). Upstream notes diagnostic **ordering** can differ.

## 4. Recommendation

**Wait (do not adopt behind a flag for DO typecheck yet).**

Reasons tied to evidence:

1. **Memory**: baseline Wasm linear memory (~97 MiB on tiny packages, 80 MiB of
   it shadow stack) leaves almost no room under the 128 MiB isolate cap once JS,
   staging, and package sources are added. This is the same pressure class as
   KODY-BR / throwaway DO typecheck.
2. **Maturity**: experimental beta; pins TS 7.1 while Kody's checker is TS 6.0.3
   via worker-bundler.
3. **Bundle size**: ~9.5 MiB Wasm (within 64 MiB Worker size, but cold-start
   cost).
4. **License**: Apache-2.0 (fine).
5. **Local ≠ prod**: workerd does not enforce the memory cap, so a flag-shipped
   path would need remote/preview proof before trusting DO safety.

Revisit when `@tsrs/wasm` ships a much smaller shadow stack / lower baseline
linear memory (or Cloudflare raises isolate memory for these throwaway check
DOs), and when the port targets the same TypeScript line Kody typechecks against
(or Kody moves to that line).

Optional later experiment (not this PR): Node-side native `tsrs` for offline/CI
package checks only. That does not help REPO_SESSION DO memory.
