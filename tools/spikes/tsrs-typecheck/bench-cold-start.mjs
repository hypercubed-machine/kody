#!/usr/bin/env node
/**
 * Cold-start: new Node process loads @tsrs/wasm, compiles the module, runs one
 * tiny check. Reports wall time and wasm file size.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, 'package.json'))
const wasmPath = join(
	dirname(require.resolve('@tsrs/wasm/package.json')),
	'tsrs.wasm',
)
const wasmBytes = statSync(wasmPath).size

const rounds = 5
const samples = []
for (let i = 0; i < rounds; i++) {
	const t0 = performance.now()
	const proc = spawnSync(process.execPath, [join(here, 'cold-child.mjs')], {
		encoding: 'utf8',
		cwd: here,
		env: process.env,
	})
	const wallExternalMs = performance.now() - t0
	if (proc.status !== 0) {
		console.error(proc.stderr || proc.stdout)
		process.exit(1)
	}
	const line = proc.stdout.trim().split('\n').at(-1)
	samples.push({ ...JSON.parse(line), wallExternalMs })
}

const median = (key) => {
	const vals = samples.map((s) => s[key]).sort((a, b) => a - b)
	return vals[Math.floor(vals.length / 2)]
}

const out = {
	when: new Date().toISOString(),
	wasmBytes,
	wasmMiB: wasmBytes / (1024 * 1024),
	median: {
		compileMs: median('compileMs'),
		checkMs: median('checkMs'),
		wallMs: median('wallMs'),
		wallExternalMs: median('wallExternalMs'),
		memoryBytes: median('memoryBytes'),
		memoryMiB: median('memoryBytes') / (1024 * 1024),
	},
	samples,
}

mkdirSync(join(here, 'results'), { recursive: true })
writeFileSync(
	join(here, 'results', 'cold-start.json'),
	JSON.stringify(out, null, 2),
)
console.log(JSON.stringify(out, null, 2))
