#!/usr/bin/env node
/**
 * Synthetic package trees modeled on Kody publish/typecheck shapes.
 * No user packages; intentionally public fixture shapes only.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Keep generated .ts trees out of tools/** typecheck (intentional errors).
const root =
	process.env.TSRS_SPIKE_FIXTURE_ROOT ??
	join('/tmp', 'kody-tsrs-typecheck-fixtures')

const tsconfig = {
	compilerOptions: {
		strict: true,
		noEmit: true,
		target: 'ES2022',
		module: 'ESNext',
		moduleResolution: 'bundler',
		skipLibCheck: true,
		allowImportingTsExtensions: true,
		lib: ['ES2022'],
		types: [],
	},
	include: ['**/*.ts', '**/*.d.ts'],
}

/** Minimal ambient for kody:runtime (subset of checks.ts prelude). */
const kodyRuntimeStub = `declare module "kody:runtime" {
  export const kody: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
  export function hasScope(request: Request, scope: string): boolean;
  export const packageContext: { packageId: string; kodyId: string } | null;
}
`

function writeTree(name, files) {
	const dir = join(root, name)
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(dir, { recursive: true })
	for (const [rel, content] of Object.entries(files)) {
		const path = join(dir, rel)
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, content)
	}
	return dir
}

function small() {
	return writeTree('small', {
		'tsconfig.json': JSON.stringify(tsconfig, null, 2),
		'package.json': JSON.stringify(
			{
				name: '@fixture/small-callable',
				type: 'module',
				kody: { jobs: { main: { entry: './src/index.ts' } } },
				exports: { '.': './src/index.ts' },
			},
			null,
			2,
		),
		// Non-dot path: tsconfig globs often skip dotfiles; Kody's real prelude
		// is injected into the VFS the language service already sees.
		'kody-runtime.d.ts': kodyRuntimeStub,
		'src/index.ts': `import { kody } from "kody:runtime";

export default async function main(input: { name: string }): Promise<{ ok: true; len: number }> {
  await kody.log?.({ message: input.name });
  return { ok: true, len: input.name.length };
}

// Intentional error for parity runs
export const intentional: number = "bad" as unknown as string;
`,
	})
}

function medium() {
	/** @type {Record<string, string>} */
	const files = {
		'tsconfig.json': JSON.stringify(tsconfig, null, 2),
		'package.json': JSON.stringify(
			{
				name: '@fixture/medium-app',
				type: 'module',
				kody: {
					jobs: {
						sync: { entry: './src/jobs/sync.ts' },
						report: { entry: './src/jobs/report.ts' },
					},
				},
				exports: {
					'.': './src/index.ts',
					'./types': { types: './src/types.ts' },
				},
				dependencies: { zod: '^3.23.0' },
			},
			null,
			2,
		),
		'kody-runtime.d.ts': kodyRuntimeStub,
		'node_modules/zod/package.json': JSON.stringify({
			name: 'zod',
			types: 'index.d.ts',
		}),
		'node_modules/zod/index.d.ts': `export type ZodTypeAny = { parse(data: unknown): unknown };
export declare const z: {
  string(): ZodTypeAny;
  object(shape: Record<string, ZodTypeAny>): ZodTypeAny;
  number(): ZodTypeAny;
};
`,
		'src/types.ts': `export type UserId = string & { readonly __brand: "UserId" };
export type RecordRow = { id: UserId; score: number; tags: ReadonlyArray<string> };
export function asUserId(value: string): UserId { return value as UserId; }
`,
		'src/schema.ts': `import { z } from "zod";
import type { RecordRow } from "./types.ts";

export const rowSchema = z.object({
  id: z.string(),
  score: z.number(),
  tags: z.string() as unknown as ReturnType<typeof z.string>,
});

export function parseRow(data: unknown): RecordRow {
  const parsed = rowSchema.parse(data) as { id: string; score: number; tags: string };
  return { id: parsed.id as RecordRow["id"], score: parsed.score, tags: [parsed.tags] };
}
`,
		'src/lib/math.ts': `export function sum(values: ReadonlyArray<number>): number {
  return values.reduce((a, b) => a + b, 0);
}
export function average(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}
`,
		'src/lib/format.ts': `import type { RecordRow } from "../types.ts";
export function formatRow(row: RecordRow): string {
  return \`\${row.id}:\${row.score}[\${row.tags.join(",")}]\`;
}
`,
		'src/bug.ts': `export const mediumBug: number = "oops";
`,
	}

	for (let i = 0; i < 20; i++) {
		const id = String(i).padStart(2, '0')
		files[`src/modules/mod-${id}.ts`] =
			`import { average } from "../lib/math.ts";
import { formatRow } from "../lib/format.ts";
import { asUserId, type RecordRow } from "../types.ts";

export function buildRow${id}(score: number): RecordRow {
  return { id: asUserId("u-${id}"), score, tags: ["m${id}"] };
}
export function summarize${id}(rows: ReadonlyArray<RecordRow>): string {
  const avg = average(rows.map((r) => r.score));
  return rows.map(formatRow).join("|") + "#avg=" + avg;
}
`
	}

	files['src/index.ts'] = `import { parseRow } from "./schema.ts";
import { summarize00 } from "./modules/mod-00.ts";
import { summarize19 } from "./modules/mod-19.ts";
import "./bug.ts";
export type { RecordRow, UserId } from "./types.ts";
export function handle(data: unknown): string {
  const row = parseRow(data);
  return summarize00([row]) + "/" + summarize19([row]);
}
`
	files['src/jobs/sync.ts'] = `import { kody } from "kody:runtime";
import { handle } from "../index.ts";
export default async function sync(input: { payload: unknown }): Promise<{ out: string }> {
  await kody.trace?.({ step: "sync" });
  return { out: handle(input.payload) };
}
`
	files['src/jobs/report.ts'] = `import { average } from "../lib/math.ts";
import { buildRow05 } from "../modules/mod-05.ts";
export default async function report(input: { scores: number[] }): Promise<{ avg: number }> {
  const rows = input.scores.map((s) => buildRow05(s));
  return { avg: average(rows.map((r) => r.score)) };
}
`
	return writeTree('medium', files)
}

function large() {
	/** @type {Record<string, string>} */
	const files = {
		'tsconfig.json': JSON.stringify(tsconfig, null, 2),
		'package.json': JSON.stringify(
			{
				name: '@fixture/large-workspace',
				type: 'module',
				kody: {
					jobs: Object.fromEntries(
						Array.from({ length: 8 }, (_, i) => [
							`job${i}`,
							{ entry: `./src/jobs/job-${i}.ts` },
						]),
					),
				},
				exports: { '.': './src/index.ts' },
			},
			null,
			2,
		),
		'kody-runtime.d.ts': kodyRuntimeStub,
		'src/core/result.ts': `export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = string> = Ok<T> | Err<E>;
export function ok<T>(value: T): Ok<T> { return { ok: true, value }; }
export function err<E>(error: E): Err<E> { return { ok: false, error }; }
export function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}
`,
		'src/core/brand.ts': `export type Brand<T, B extends string> = T & { readonly __brand: B };
export function brand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}
`,
		'src/bug.ts': `export const largeBug: number = "oops";
`,
	}

	for (let g = 0; g < 10; g++) {
		files[`src/domain/group-${g}/types.ts`] =
			`import type { Brand } from "../../core/brand.ts";
export type Id${g} = Brand<string, "Id${g}">;
export type Entity${g} = { id: Id${g}; n: number; label: string };
export function id${g}(raw: string): Id${g} { return raw as Id${g}; }
`
		for (let m = 0; m < 18; m++) {
			files[`src/domain/group-${g}/mod-${m}.ts`] =
				`import { ok, type Result } from "../../core/result.ts";
import { id${g}, type Entity${g} } from "./types.ts";

export function make${g}_${m}(n: number): Entity${g} {
  return { id: id${g}("g${g}-m${m}-" + n), n, label: "g${g}/m${m}" };
}
export function check${g}_${m}(e: Entity${g}): Result<Entity${g}> {
  if (e.n < 0) return { ok: false, error: "negative" };
  return ok(e);
}
export function pipe${g}_${m}(values: number[]): Entity${g}[] {
  return values.map((n) => make${g}_${m}(n)).filter((e) => check${g}_${m}(e).ok);
}
`
		}
		files[`src/domain/group-${g}/index.ts`] =
			Array.from(
				{ length: 18 },
				(_, m) => `export * from "./mod-${m}.ts";`,
			).join('\n') + '\n'
	}

	files['src/index.ts'] =
		Array.from(
			{ length: 10 },
			(_, g) => `export * from "./domain/group-${g}/index.ts";`,
		).join('\n') +
		`
import { make0_0 } from "./domain/group-0/mod-0.ts";
import "./bug.ts";
export function sample(): number { return make0_0(1).n; }
`

	for (let i = 0; i < 8; i++) {
		const g = i % 10
		files[`src/jobs/job-${i}.ts`] = `import { kody } from "kody:runtime";
import { pipe${g}_0 } from "../domain/group-${g}/mod-0.ts";
export default async function job${i}(input: { values: number[] }): Promise<{ count: number }> {
  await kody.trace?.({ job: ${i} });
  return { count: pipe${g}_0(input.values).length };
}
`
	}

	return writeTree('large', files)
}

small()
medium()
large()
console.log('fixtures written under', root)
