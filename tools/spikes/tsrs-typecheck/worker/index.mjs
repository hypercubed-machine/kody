/**
 * Minimal Worker probe for @tsrs/wasm inside local workerd.
 * Research spike only. Do not deploy.
 */
import { tsc } from './vendor-runtime/browser.js'
import wasmModule from './vendor-runtime/tsrs.wasm'

const SMALL = {
	'/pkg/tsconfig.json': JSON.stringify({
		compilerOptions: {
			strict: true,
			noEmit: true,
			target: 'ES2022',
			module: 'ESNext',
			moduleResolution: 'bundler',
			skipLibCheck: true,
			lib: ['ES2022'],
			types: [],
		},
		include: ['**/*.ts'],
	}),
	'/pkg/src/index.ts': `export default function main(x: string): number { return x.length; }
export const intentional: number = "bad" as unknown as string;
`,
}

export default {
	async fetch(request) {
		const url = new URL(request.url)
		if (url.pathname === '/health') {
			return Response.json({ ok: true, spike: 'tsrs-typecheck' })
		}
		if (url.pathname !== '/typecheck') {
			return new Response('not found', { status: 404 })
		}

		const started = Date.now()
		try {
			const result = await tsc(
				['-p', '/pkg', '--noEmit', '--pretty', 'false'],
				{
					files: SMALL,
					cwd: '/pkg',
					diagnostics: 'json',
					module: wasmModule,
				},
			)
			return Response.json({
				ok: true,
				wallMs: Date.now() - started,
				exitCode: result.exitCode,
				memoryBytes: result.memoryBytes,
				memoryMiB: result.memoryBytes / (1024 * 1024),
				diagCount: result.diagnostics?.length ?? 0,
				diagnostics: result.diagnostics ?? [],
				stderr: result.stderr,
			})
		} catch (error) {
			return Response.json(
				{
					ok: false,
					wallMs: Date.now() - started,
					error: String(error?.message ?? error),
					name: error?.name ?? null,
					stack: String(error?.stack ?? '').slice(0, 2000),
				},
				{ status: 500 },
			)
		}
	},
}
