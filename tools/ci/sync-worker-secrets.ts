import { spawn } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isExecutedDirectly, resolveLocalBinary } from '../node-runtime.ts'
import { isRetryableDeployFailure } from './is-retryable-deploy-failure.ts'
import { fail } from './resource-utils.ts'

const ansiEscapePattern = new RegExp(`${'\u001b'}\\[[0-9;]*m`, 'g')

export type SecretBulkAttemptResult = {
	exitCode: number
	output: string
}

/**
 * Cloudflare rejects legacy `wrangler secret bulk` with 10215 when the
 * Worker's latest uploaded version is not the version currently serving
 * traffic (for example after a deploy that uploaded successfully then failed
 * on the deployments API). Activating that orphan would put unknown/partial
 * code live, so recovery uses `wrangler versions secret bulk` instead: it
 * patches secrets onto a new undeployed version without changing traffic.
 * The following `wrangler deploy` uploads the intended checkout and activates
 * that known code (see #4027).
 */
export function isUndeployedLatestSecretError(output: string) {
	const text = output.replace(ansiEscapePattern, '')
	return (
		/\[code:\s*10215\]/.test(text) ||
		/latest version of your Worker isn't currently deployed/i.test(text)
	)
}

export type RetrySecretBulkUploadOptions = {
	attempts?: number
	baseDelayMs?: number
	sleep?: (ms: number) => Promise<void>
	isRetryable?: (output: string) => boolean
	onRetry?: (input: {
		attempt: number
		attempts: number
		delayMs: number
	}) => void
}

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Bounded retry for wrangler secret bulk. Matches production deploy's
 * 3-attempt, 10s-then-double budget so an edge 503 does not fail the job.
 */
export async function retrySecretBulkUpload(
	runAttempt: () => Promise<SecretBulkAttemptResult>,
	options: RetrySecretBulkUploadOptions = {},
): Promise<SecretBulkAttemptResult> {
	const attempts = options.attempts ?? 3
	const baseDelayMs = options.baseDelayMs ?? 10_000
	const wait = options.sleep ?? sleep
	const isRetryable = options.isRetryable ?? isRetryableDeployFailure
	const onRetry =
		options.onRetry ??
		((input) => {
			console.log(
				`Retryable Cloudflare secret sync failure detected; retrying in ${input.delayMs / 1000}s.`,
			)
		})

	let lastResult: SecretBulkAttemptResult = { exitCode: 1, output: '' }
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		lastResult = await runAttempt()
		if (lastResult.exitCode === 0) {
			return lastResult
		}
		if (attempt === attempts || !isRetryable(lastResult.output)) {
			return lastResult
		}
		const delayMs = baseDelayMs * 2 ** (attempt - 1)
		onRetry({ attempt, attempts, delayMs })
		await wait(delayMs)
	}
	return lastResult
}

export type CliOptions = {
	env?: string
	name?: string
	config?: string
	dotenvPaths: Array<string>
	setPairs: Array<string>
	setFromEnv: Array<string>
	setFromEnvOptional: Array<string>
	generateCookieSecret: boolean
	includeEmpty: boolean
	emptyAsSpace: boolean
}

function parseArgs(argv: Array<string>): CliOptions {
	const options: CliOptions = {
		env: undefined,
		dotenvPaths: [],
		setPairs: [],
		setFromEnv: [],
		setFromEnvOptional: [],
		generateCookieSecret: false,
		includeEmpty: false,
		emptyAsSpace: false,
	}

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (!arg) continue
		switch (arg) {
			case '--env': {
				const envName = argv[index + 1]
				if (envName === undefined) {
					fail('Missing value for --env <environment>')
				}
				options.env = envName
				index += 1
				break
			}
			case '--name': {
				options.name = argv[index + 1] ?? ''
				index += 1
				break
			}
			case '--config': {
				options.config = argv[index + 1] ?? ''
				index += 1
				break
			}
			case '--from-dotenv': {
				const path = argv[index + 1] ?? ''
				if (path) options.dotenvPaths.push(path)
				index += 1
				break
			}
			case '--set': {
				const pair = argv[index + 1] ?? ''
				if (pair) options.setPairs.push(pair)
				index += 1
				break
			}
			case '--set-from-env': {
				const key = argv[index + 1] ?? ''
				if (key) options.setFromEnv.push(key)
				index += 1
				break
			}
			case '--set-from-env-optional': {
				const key = argv[index + 1] ?? ''
				if (key) options.setFromEnvOptional.push(key)
				index += 1
				break
			}
			case '--generate-cookie-secret': {
				options.generateCookieSecret = true
				break
			}
			case '--include-empty': {
				options.includeEmpty = true
				break
			}
			case '--empty-as-space': {
				options.emptyAsSpace = true
				break
			}
			default: {
				if (arg.startsWith('--set-from-env-optional=')) {
					const key = arg.slice('--set-from-env-optional='.length).trim()
					if (key) options.setFromEnvOptional.push(key)
					break
				}
				if (arg.startsWith('-')) {
					fail(`Unknown flag: ${arg}`)
				}
			}
		}
	}

	return options
}

function stripQuotesPreservingKind(value: string): {
	value: string
	quote: '"' | "'" | null
} {
	const trimmed = value.trim()
	if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
		return { value: trimmed.slice(1, -1), quote: '"' }
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
		return { value: trimmed.slice(1, -1), quote: "'" }
	}
	return { value: trimmed, quote: null }
}

/**
 * Dotenv double-quoted values use backslash escapes (`\n`, `\r`, `\\`, `\"`).
 * Single-quoted values are literal except for `\'`. Unquoted values are
 * unchanged after trim/quote strip.
 */
export function unescapeDotenvValue(value: string, quote: '"' | "'" | null) {
	if (quote === '"') {
		let result = ''
		for (let index = 0; index < value.length; index += 1) {
			const char = value[index]
			if (char !== '\\' || index + 1 >= value.length) {
				result += char
				continue
			}
			const next = value[index + 1]
			index += 1
			switch (next) {
				case 'n':
					result += '\n'
					break
				case 'r':
					result += '\r'
					break
				case 't':
					result += '\t'
					break
				case '"':
					result += '"'
					break
				case '\\':
					result += '\\'
					break
				default:
					result += `\\${next}`
					break
			}
		}
		return result
	}
	if (quote === "'") {
		return value.replace(/\\'/g, "'")
	}
	return value
}

export function parseDotenv(content: string) {
	const result = new Map<string, string>()
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line) continue
		if (line.startsWith('#')) continue
		const withoutExport = line.startsWith('export ') ? line.slice(7) : line
		const equalsIndex = withoutExport.indexOf('=')
		if (equalsIndex <= 0) continue
		const key = withoutExport.slice(0, equalsIndex).trim()
		const { value, quote } = stripQuotesPreservingKind(
			withoutExport.slice(equalsIndex + 1),
		)
		if (!key) continue
		result.set(key, unescapeDotenvValue(value, quote))
	}
	return result
}

function parseSetPair(pair: string) {
	const equalsIndex = pair.indexOf('=')
	if (equalsIndex <= 0) {
		fail(`Invalid --set value (expected KEY=VALUE): ${pair}`)
	}
	const key = pair.slice(0, equalsIndex).trim()
	const value = pair.slice(equalsIndex + 1)
	if (!key) {
		fail(`Invalid --set value (empty key): ${pair}`)
	}
	return { key, value }
}

/**
 * `--set-from-env NAME` reads `process.env.NAME`; `--set-from-env NAME=SOURCE`
 * reads `process.env.SOURCE` and uploads it as the Worker secret `NAME`. The
 * alias form lets a worker receive a different value than the variable of the
 * same name in the deploy shell (for example a narrower `CLOUDFLARE_API_TOKEN`
 * than the one wrangler itself authenticates with).
 *
 * `--set-from-env` rejects empty values: GitHub Actions renders an unset
 * secret as `''`, so accepting it would silently skip a required secret.
 */
export function parseEnvSourceSpec(spec: string) {
	const separator = spec.indexOf('=')
	if (separator === -1) {
		return { key: spec, sourceKey: spec }
	}
	const key = spec.slice(0, separator).trim()
	const sourceKey = spec.slice(separator + 1).trim()
	if (!key || !sourceKey) {
		fail(`Invalid --set-from-env spec "${spec}" (expected NAME or NAME=SOURCE)`)
	}
	return { key, sourceKey }
}

function generateHexSecret(bytes: number) {
	return randomBytes(bytes).toString('hex')
}

export async function buildSecrets(options: CliOptions) {
	const secrets = new Map<string, string>()

	for (const path of options.dotenvPaths) {
		const content = await readFile(path, 'utf8')
		for (const [key, value] of parseDotenv(content)) {
			secrets.set(key, value)
		}
	}

	for (const spec of options.setFromEnv) {
		const { key, sourceKey } = parseEnvSourceSpec(spec)
		const value = process.env[sourceKey]
		if (typeof value !== 'string' || value.length === 0) {
			fail(`Missing required environment variable: ${sourceKey}`)
		}
		secrets.set(key, value)
	}

	for (const spec of options.setFromEnvOptional) {
		const { key, sourceKey } = parseEnvSourceSpec(spec)
		const value = process.env[sourceKey]
		if (typeof value === 'string' && value.length > 0) {
			secrets.set(key, value)
		}
	}

	for (const pair of options.setPairs) {
		const { key, value } = parseSetPair(pair)
		secrets.set(key, value)
	}

	if (options.generateCookieSecret) {
		const cookieSecret = generateHexSecret(32)
		// GitHub Actions log masking (no-op elsewhere).
		console.log(`::add-mask::${cookieSecret}`)
		secrets.set('COOKIE_SECRET', cookieSecret)
	}

	if (!options.includeEmpty) {
		for (const [key, value] of secrets) {
			if (value.length === 0) {
				secrets.delete(key)
			}
		}
	} else if (options.emptyAsSpace) {
		for (const [key, value] of secrets) {
			if (value.length === 0) {
				secrets.set(key, ' ')
			}
		}
	}

	return secrets
}

export function buildSpawnEnv(
	options: CliOptions,
	baseEnv: NodeJS.ProcessEnv = process.env,
) {
	const spawnEnv: Record<string, string> = {}
	for (const [key, value] of Object.entries(baseEnv)) {
		if (typeof value === 'string') {
			spawnEnv[key] = value
		}
	}
	for (const spec of options.setFromEnvOptional) {
		const { sourceKey } = parseEnvSourceSpec(spec)
		if (spawnEnv[sourceKey] !== undefined && spawnEnv[sourceKey].length === 0) {
			delete spawnEnv[sourceKey]
		}
	}
	return spawnEnv
}

function escapeDotenvValue(value: string) {
	if (!/[\n\r\t"\\]/.test(value) && value === value.trim()) {
		return value
	}
	return `"${value
		.replace(/\\/g, '\\\\')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t')
		.replace(/"/g, '\\"')}"`
}

export function toDotenv(secrets: ReadonlyMap<string, string>) {
	const lines = Array.from(secrets.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${escapeDotenvValue(value)}`)
	return `${lines.join('\n')}\n`
}

/**
 * `wrangler secret bulk --env <env> --name <script>` still targets
 * `<script>-<env>` (unlike `wrangler deploy --name`, which overrides the
 * suffix). Callers that pin a script with `--name` must omit `--env`. The
 * versions secret bulk path uses the same env/name rules.
 */
export function buildWranglerSecretBulkFlags(
	options: CliOptions,
	secretsFilePath: string,
	mode: 'legacy' | 'versions' = 'legacy',
): Array<string> {
	if (options.name && options.env && options.env.length > 0) {
		fail(
			`wrangler secret bulk appends -<env> even when --name is set, so "${options.name}" with --env ${options.env} would target "${options.name}-${options.env}". Pass --env "" with --name to pin the unsuffixed script.`,
		)
	}
	const args =
		mode === 'versions'
			? ['versions', 'secret', 'bulk', secretsFilePath]
			: ['secret', 'bulk', secretsFilePath]
	if (options.env !== undefined && options.env.length > 0) {
		args.push('--env', options.env)
	}
	if (options.name) {
		args.push('--name', options.name)
	}
	if (options.config) {
		args.push('--config', options.config)
	}
	return args
}

export async function syncSecretsWithUndeployedLatestRecovery(input: {
	runLegacy: () => Promise<SecretBulkAttemptResult>
	runVersions: () => Promise<SecretBulkAttemptResult>
	retry?: typeof retrySecretBulkUpload
	onVersionsFallback?: (legacyOutput: string) => void
}): Promise<SecretBulkAttemptResult> {
	const retry = input.retry ?? retrySecretBulkUpload
	const legacy = await retry(input.runLegacy)
	if (legacy.exitCode === 0) {
		return legacy
	}
	if (!isUndeployedLatestSecretError(legacy.output)) {
		return legacy
	}
	input.onVersionsFallback?.(legacy.output)
	// versions secret bulk is not subject to the 10215 gate; still use the
	// same transient-retry budget for edge 5xx.
	return retry(input.runVersions)
}

async function runWranglerSecretBulk(options: CliOptions, dotenvText: string) {
	const wranglerBin = resolveLocalBinary('wrangler')
	const spawnEnv = buildSpawnEnv(options)
	const secretsFilePath = join(
		tmpdir(),
		`wrangler-secrets-${Date.now()}-${randomBytes(6).toString('hex')}.env`,
	)
	await writeFile(secretsFilePath, dotenvText, {
		encoding: 'utf8',
		mode: 0o600,
	})

	try {
		const result = await syncSecretsWithUndeployedLatestRecovery({
			runLegacy: () =>
				runWranglerSecretBulkOnce(
					wranglerBin,
					buildWranglerSecretBulkFlags(options, secretsFilePath, 'legacy'),
					spawnEnv,
				),
			runVersions: () =>
				runWranglerSecretBulkOnce(
					wranglerBin,
					buildWranglerSecretBulkFlags(options, secretsFilePath, 'versions'),
					spawnEnv,
				),
			onVersionsFallback: () => {
				console.log(
					'Legacy wrangler secret bulk failed because the latest Worker version is not deployed (Cloudflare 10215). Falling back to wrangler versions secret bulk so secrets update without activating the undeployed version; the following wrangler deploy uploads and activates the intended checkout (#4027).',
				)
			},
		})
		if (result.exitCode !== 0) {
			process.exit(result.exitCode)
		}
	} finally {
		await unlink(secretsFilePath).catch(() => {})
	}
}

function runWranglerSecretBulkOnce(
	command: string,
	commandArgs: Array<string>,
	spawnEnv: Record<string, string>,
): Promise<SecretBulkAttemptResult> {
	const proc = spawn(command, commandArgs, {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: spawnEnv,
	})
	return collectSpawnedProcessOutput(proc)
}

/**
 * Wait for `close` (not `exit`) so the last stdout/stderr chunks are in
 * `output` before retry classification. `exit` can fire while those pipes
 * still have unread data.
 */
export type SpawnedProcessOutputSource = {
	stdout: NodeJS.ReadableStream | null
	stderr: NodeJS.ReadableStream | null
	once(event: 'error', listener: (error: Error) => void): void
	once(event: 'close', listener: (code: number | null) => void): void
}

export function collectSpawnedProcessOutput(
	proc: SpawnedProcessOutputSource,
): Promise<SecretBulkAttemptResult> {
	const chunks: Array<string> = []
	function forward(
		stream: NodeJS.ReadableStream | null,
		dest: NodeJS.WriteStream,
	) {
		if (!stream) return
		stream.on('data', (chunk: Buffer | string) => {
			const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
			chunks.push(text)
			dest.write(chunk)
		})
	}
	forward(proc.stdout, process.stdout)
	forward(proc.stderr, process.stderr)
	return new Promise((resolve, reject) => {
		proc.once('error', reject)
		proc.once('close', (code: number | null) => {
			resolve({
				exitCode: code ?? 1,
				output: chunks.join(''),
			})
		})
	})
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const secrets = await buildSecrets(options)
	if (secrets.size === 0) {
		fail('No secrets to sync (empty input).')
	}
	const dotenvText = toDotenv(secrets)
	await runWranglerSecretBulk(options, dotenvText)
	const envLabel =
		options.env && options.env.length > 0 ? options.env : 'default'
	console.log(
		`Synced ${secrets.size} secret(s) via bulk upload (${envLabel}${options.name ? `, ${options.name}` : ''}).`,
	)
}

if (isExecutedDirectly(import.meta.url)) {
	await main()
}
