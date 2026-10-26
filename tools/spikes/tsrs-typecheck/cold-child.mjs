import { tsc, loadModule } from '@tsrs/wasm'

const t0 = performance.now()
const mod = await loadModule()
const tCompile = performance.now()
const result = await tsc(['/pkg/a.ts', '--noEmit', '--pretty', 'false'], {
	files: { '/pkg/a.ts': 'const x: number = 1;' },
	cwd: '/pkg',
	diagnostics: 'json',
	module: mod,
})
const tDone = performance.now()
console.log(
	JSON.stringify({
		compileMs: tCompile - t0,
		checkMs: tDone - tCompile,
		wallMs: tDone - t0,
		memoryBytes: result.memoryBytes,
		exitCode: result.exitCode,
	}),
)
