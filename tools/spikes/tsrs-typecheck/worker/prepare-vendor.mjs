#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spikeRoot = join(here, '..')
const require = createRequire(join(spikeRoot, 'package.json'))
const wasmDir = dirname(require.resolve('@tsrs/wasm/package.json'))
const vendorRuntime = join(here, 'vendor-runtime')

rmSync(vendorRuntime, { recursive: true, force: true })
mkdirSync(vendorRuntime, { recursive: true })
for (const name of ['browser.js', 'core.js', 'tsrs.wasm']) {
	const src = join(wasmDir, name)
	if (!existsSync(src)) throw new Error(`missing ${name} in ${wasmDir}`)
	cpSync(src, join(vendorRuntime, name))
}

writeFileSync(
	join(vendorRuntime, 'meta.json'),
	JSON.stringify(
		{
			wasmDir,
			preparedAt: new Date().toISOString(),
			note: 'Copied from @tsrs/wasm for local wrangler; do not deploy.',
		},
		null,
		2,
	),
)
console.log('prepared', vendorRuntime)
