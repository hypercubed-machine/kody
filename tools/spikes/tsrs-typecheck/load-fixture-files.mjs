import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Walk a fixture directory into an absolute-path in-memory map for @tsrs/wasm,
 * plus a relative-path map for createTypescriptLanguageService.
 */
export function loadFixtureFiles(fixtureDir, { absoluteRoot = '/pkg' } = {}) {
	/** @type {Record<string, string>} */
	const relativeFiles = {}
	/** @type {Record<string, string>} */
	const absoluteFiles = {}

	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry)
			const st = statSync(full)
			if (st.isDirectory()) {
				if (entry === 'node_modules') {
					// Keep dep type stubs; skip nested junk.
				}
				walk(full)
				continue
			}
			if (!/\.(ts|tsx|json|d\.ts)$/.test(entry) && !entry.endsWith('.d.ts')) {
				if (!entry.endsWith('.json')) continue
			}
			const rel = relative(fixtureDir, full).replaceAll('\\', '/')
			const content = readFileSync(full, 'utf8')
			relativeFiles[rel] = content
			absoluteFiles[`${absoluteRoot}/${rel}`] = content
		}
	}

	walk(fixtureDir)
	return { relativeFiles, absoluteFiles, absoluteRoot }
}

export function countFixtureStats(relativeFiles) {
	const encoder = new TextEncoder()
	let bytes = 0
	let tsFiles = 0
	for (const [path, content] of Object.entries(relativeFiles)) {
		bytes += encoder.encode(content).byteLength
		if (/\.tsx?$/.test(path)) tsFiles += 1
	}
	return {
		fileCount: Object.keys(relativeFiles).length,
		tsFiles,
		bytes,
	}
}
