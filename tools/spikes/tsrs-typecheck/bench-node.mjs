#!/usr/bin/env node
/**
 * Node-side comparison: Kody's worker-bundler TypeScript language service
 * vs @tsrs/wasm in-memory typecheck on the same synthetic fixtures.
 *
 * Research spike only. Not wired into publish/dev checks.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { loadFixtureFiles, countFixtureStats } from './load-fixture-files.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../..')

const sizes = ['small', 'medium', 'large']
const rounds = Number(process.env.BENCH_ROUNDS ?? 3)

function rssMb() {
	return process.memoryUsage().rss / (1024 * 1024)
}

function peakRssDuring(fn) {
	const start = rssMb()
	let peak = start
	const timer = setInterval(() => {
		peak = Math.max(peak, rssMb())
	}, 10)
	return Promise.resolve()
		.then(fn)
		.finally(() => {
			clearInterval(timer)
			peak = Math.max(peak, rssMb())
		})
		.then((result) => ({ result, peakRssMb: peak, startRssMb: start }))
}

async function runLanguageService(relativeFiles) {
	const { createTypescriptLanguageService } = await import(
		pathToFileURL(
			join(
				repoRoot,
				'node_modules/@cloudflare/worker-bundler/dist/typescript.js',
			),
		).href
	)
	const bundler = await import(
		pathToFileURL(
			join(repoRoot, 'node_modules/@cloudflare/worker-bundler/dist/index.js'),
		).href
	)
	const InMemoryFileSystem = bundler.InMemoryFileSystem
	if (!InMemoryFileSystem) {
		throw new Error('InMemoryFileSystem export missing from worker-bundler')
	}

	const fs = new InMemoryFileSystem(relativeFiles)
	const created = await createTypescriptLanguageService({ fileSystem: fs })
	const { languageService, fileSystem } = created
	try {
		const roots = Object.keys(relativeFiles)
			.filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts'))
			.sort()
		/** @type {Array<{ fileName: string; code?: number; message: string; start?: number }>} */
		const diagnostics = []
		for (const path of roots) {
			for (const d of languageService.getSemanticDiagnostics(path)) {
				diagnostics.push({
					fileName: d.file?.fileName?.replace(/\\/g, '/') ?? path,
					code: d.code,
					message: flattenMessage(d.messageText),
					start: d.start,
				})
			}
		}
		return { diagnostics, engine: 'typescript-language-service' }
	} finally {
		languageService.dispose()
		void fileSystem
	}
}

function flattenMessage(messageText) {
	if (typeof messageText === 'string') return messageText
	if (
		messageText &&
		typeof messageText === 'object' &&
		'messageText' in messageText
	) {
		return String(messageText.messageText)
	}
	return JSON.stringify(messageText)
}

async function runTsrsWasm(absoluteFiles, absoluteRoot) {
	const { tsc } = await import('@tsrs/wasm')
	const result = await tsc(
		['-p', absoluteRoot, '--noEmit', '--pretty', 'false'],
		{
			files: absoluteFiles,
			cwd: absoluteRoot,
			diagnostics: 'json',
		},
	)
	const diagnostics = (result.diagnostics ?? []).map((d) => ({
		fileName: d.fileName,
		code: d.code,
		message: d.text,
		start: d.pos,
		end: d.end,
		category: d.category,
	}))
	return {
		diagnostics,
		exitCode: result.exitCode,
		memoryBytes: result.memoryBytes,
		stderr: result.stderr,
		engine: 'tsrs-wasm',
	}
}

function normalizeDiagKey(d) {
	const file = String(d.fileName ?? '')
		.replace(/^\/pkg\//, '')
		.replace(/.*\//, (m, offset, s) => {
			// Keep path relative when possible
			return s.includes('/src/') ? s.slice(s.indexOf('src/')) : m
		})
	const rel = file.includes('src/')
		? file.slice(file.indexOf('src/'))
		: file.replace(/^\/pkg\//, '')
	return `${rel}|${d.code ?? ''}|${d.message ?? ''}`
}

function compareParity(lsDiags, tsrsDiags) {
	const lsKeys = new Set(lsDiags.map(normalizeDiagKey))
	const tsrsKeys = new Set(tsrsDiags.map(normalizeDiagKey))
	const onlyLs = [...lsKeys].filter((k) => !tsrsKeys.has(k))
	const onlyTsrs = [...tsrsKeys].filter((k) => !lsKeys.has(k))
	const shared = [...lsKeys].filter((k) => tsrsKeys.has(k))
	return {
		lsCount: lsDiags.length,
		tsrsCount: tsrsDiags.length,
		sharedCount: shared.length,
		onlyLanguageService: onlyLs,
		onlyTsrs,
	}
}

async function benchSize(size) {
	const fixtureDir = join(here, 'fixtures', size)
	const { relativeFiles, absoluteFiles, absoluteRoot } =
		loadFixtureFiles(fixtureDir)
	const stats = countFixtureStats(relativeFiles)

	const lsRuns = []
	for (let i = 0; i < rounds; i++) {
		global.gc?.()
		const t0 = performance.now()
		const { result, peakRssMb, startRssMb } = await peakRssDuring(() =>
			runLanguageService(relativeFiles),
		)
		const wallMs = performance.now() - t0
		lsRuns.push({
			wallMs,
			peakRssMb,
			deltaRssMb: peakRssMb - startRssMb,
			diagCount: result.diagnostics.length,
			diagnostics: result.diagnostics,
		})
	}

	const tsrsRuns = []
	for (let i = 0; i < rounds; i++) {
		global.gc?.()
		const t0 = performance.now()
		const { result, peakRssMb, startRssMb } = await peakRssDuring(() =>
			runTsrsWasm(absoluteFiles, absoluteRoot),
		)
		const wallMs = performance.now() - t0
		tsrsRuns.push({
			wallMs,
			peakRssMb,
			deltaRssMb: peakRssMb - startRssMb,
			diagCount: result.diagnostics.length,
			memoryBytes: result.memoryBytes,
			exitCode: result.exitCode,
			stderr: result.stderr,
			diagnostics: result.diagnostics,
		})
	}

	const median = (arr, key) => {
		const vals = arr.map((r) => r[key]).sort((a, b) => a - b)
		return vals[Math.floor(vals.length / 2)]
	}

	const parity = compareParity(lsRuns[0].diagnostics, tsrsRuns[0].diagnostics)

	return {
		size,
		stats,
		languageService: {
			wallMsMedian: median(lsRuns, 'wallMs'),
			peakRssMbMedian: median(lsRuns, 'peakRssMb'),
			deltaRssMbMedian: median(lsRuns, 'deltaRssMb'),
			diagCount: lsRuns[0].diagCount,
			runs: lsRuns.map(({ wallMs, peakRssMb, deltaRssMb, diagCount }) => ({
				wallMs,
				peakRssMb,
				deltaRssMb,
				diagCount,
			})),
		},
		tsrsWasm: {
			wallMsMedian: median(tsrsRuns, 'wallMs'),
			peakRssMbMedian: median(tsrsRuns, 'peakRssMb'),
			deltaRssMbMedian: median(tsrsRuns, 'deltaRssMb'),
			linearMemoryMiBMedian: median(
				tsrsRuns.map((r) => ({
					m: (r.memoryBytes ?? 0) / (1024 * 1024),
				})),
				'm',
			),
			diagCount: tsrsRuns[0].diagCount,
			exitCode: tsrsRuns[0].exitCode,
			runs: tsrsRuns.map(
				({
					wallMs,
					peakRssMb,
					deltaRssMb,
					diagCount,
					memoryBytes,
					exitCode,
				}) => ({
					wallMs,
					peakRssMb,
					deltaRssMb,
					diagCount,
					memoryBytes,
					exitCode,
				}),
			),
		},
		parity,
		versions: {
			typescript: JSON.parse(
				readFileSync(
					join(repoRoot, 'node_modules/typescript/package.json'),
					'utf8',
				),
			).version,
			workerBundler: JSON.parse(
				readFileSync(
					join(
						repoRoot,
						'node_modules/@cloudflare/worker-bundler/package.json',
					),
					'utf8',
				),
			).version,
			tsrsWasm: JSON.parse(
				readFileSync(
					join(here, 'node_modules/@tsrs/wasm/package.json'),
					'utf8',
				),
			).version,
		},
	}
}

async function main() {
	// Ensure @tsrs/wasm resolves from spike local install or /tmp smoke.
	try {
		await import('@tsrs/wasm')
	} catch {
		console.error(
			'Install @tsrs/wasm in tools/spikes/tsrs-typecheck first: npm install --prefix tools/spikes/tsrs-typecheck',
		)
		process.exit(1)
	}

	const results = []
	for (const size of sizes) {
		console.error(`bench ${size}...`)
		results.push(await benchSize(size))
	}

	mkdirSync(join(here, 'results'), { recursive: true })
	const outPath = join(here, 'results', 'node-bench.json')
	writeFileSync(
		outPath,
		JSON.stringify({ when: new Date().toISOString(), results }, null, 2),
	)
	console.log(
		JSON.stringify({ when: new Date().toISOString(), results }, null, 2),
	)
	console.error('wrote', outPath)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
