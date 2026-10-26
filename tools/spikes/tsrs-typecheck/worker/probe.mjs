#!/usr/bin/env node
/**
 * Start local wrangler for the spike Worker, hit /typecheck, record the result.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const here = dirname(fileURLToPath(import.meta.url))
const spikeRoot = join(here, '..')
const resultsDir = join(spikeRoot, 'results')
mkdirSync(resultsDir, { recursive: true })

await import('./prepare-vendor.mjs')

const port = 8799
const wranglerBin = join(
	spikeRoot,
	'../../../node_modules/wrangler/bin/wrangler.js',
)
const child = spawn(
	process.execPath,
	[
		wranglerBin,
		'dev',
		'--config',
		join(here, 'wrangler.jsonc'),
		'--local',
		'--ip',
		'127.0.0.1',
		'--port',
		String(port),
	],
	{
		cwd: here,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			// Never touch Cloudflare accounts from this probe.
			CLOUDFLARE_API_TOKEN: '',
			CLOUDFLARE_ACCOUNT_ID: '',
			WRANGLER_SEND_METRICS: 'false',
		},
	},
)

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => {
	stdout += chunk.toString()
})
child.stderr.on('data', (chunk) => {
	stderr += chunk.toString()
})

async function waitReady(timeoutMs = 120_000) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (child.exitCode != null) {
			throw new Error(
				`wrangler exited early (${child.exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
			)
		}
		try {
			const res = await fetch(`http://127.0.0.1:${port}/health`)
			if (res.ok) return
		} catch {
			// keep waiting
		}
		await sleep(500)
	}
	throw new Error(
		`wrangler did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`,
	)
}

const outcome = {
	when: new Date().toISOString(),
	port,
}

try {
	await waitReady()
	outcome.healthOk = true
	const t0 = Date.now()
	const res = await fetch(`http://127.0.0.1:${port}/typecheck`)
	const bodyText = await res.text()
	outcome.wallMs = Date.now() - t0
	outcome.status = res.status
	try {
		outcome.body = JSON.parse(bodyText)
	} catch {
		outcome.bodyText = bodyText.slice(0, 4000)
	}
} catch (error) {
	outcome.error = String(error?.message ?? error)
	outcome.stdout = stdout.slice(-4000)
	outcome.stderr = stderr.slice(-4000)
} finally {
	child.kill('SIGTERM')
	await sleep(500)
	if (child.exitCode == null) child.kill('SIGKILL')
}

const outPath = join(resultsDir, 'worker-probe.json')
writeFileSync(outPath, JSON.stringify(outcome, null, 2))
console.log(JSON.stringify(outcome, null, 2))
console.error('wrote', outPath)
if (
	outcome.error ||
	outcome.body?.ok === false ||
	(outcome.status && outcome.status >= 500)
) {
	process.exitCode = 2
}
