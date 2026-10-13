import { buildAccountSecretId } from '@kody-internal/shared/account-secret-route.ts'
import {
	type CredentialKind,
	type CredentialListItem,
	type ParsedCredentialCreateQuery,
} from '#universal/credential-contracts.ts'
import { credentialKindLabel } from '#universal/credentials-list.ts'
import { orgResourcePath } from '#universal/org-pages.ts'
import { routes } from '#universal/routes.ts'

/**
 * How the one-pager creates each kind: a form on the page for every kind the
 * person types a value for, or a hand-off to the existing OAuth or MCP flow.
 */
export type CredentialCreateMode = 'value-form' | 'handoff'

export type ValueFormKind = 'secret' | 'url' | 'login' | 'signing'

export function credentialCreateMode(
	kind: CredentialKind,
): CredentialCreateMode {
	switch (kind) {
		case 'secret':
		case 'url':
		case 'login':
		case 'signing':
			return 'value-form'
		case 'oauth':
		case 'mcp':
			return 'handoff'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

export function isValueFormKind(kind: CredentialKind): kind is ValueFormKind {
	return credentialCreateMode(kind) === 'value-form'
}

export function credentialCreateKindSummary(kind: CredentialKind) {
	switch (kind) {
		case 'secret':
			return 'An API key, token, or password Kody places on requests to the hosts you allow.'
		case 'oauth':
			return 'Sign in with a provider. Kody keeps the token fresh.'
		case 'mcp':
			return 'A remote MCP server Kody connects to for you.'
		case 'url':
			return 'A URL that carries its own secret, such as a webhook or bot URL.'
		case 'login':
			return 'A username and password Kody exchanges for a session token.'
		case 'signing':
			return 'A secret Kody signs requests or verifies webhooks with.'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

export function credentialCreateTitle(kind: CredentialKind) {
	switch (kind) {
		case 'secret':
			return 'Add a key'
		case 'oauth':
			return 'Connect an OAuth service'
		case 'mcp':
			return 'Add an MCP server'
		case 'url':
			return 'Add a URL credential'
		case 'login':
			return 'Add a login'
		case 'signing':
			return 'Add a signing secret'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

/** `href` with `kind` chosen, keeping every other param (including prefill). */
export function writeCredentialCreateKind(href: string, kind: CredentialKind) {
	const url = new URL(href, 'http://localhost')
	url.searchParams.set('kind', kind)
	return `${url.pathname}${url.search}`
}

/**
 * Where an OAuth or MCP link continues. OAuth keeps the whole query, which
 * `/connect/oauth` already reads (`provider` and its config params).
 */
export function credentialCreateHandoffHref(input: {
	kind: 'oauth' | 'mcp'
	search: URLSearchParams
	orgSlug: string
}) {
	switch (input.kind) {
		case 'oauth': {
			const query = input.search.toString()
			const path = routes.connectOauth.href()
			return query ? `${path}?${query}` : path
		}
		case 'mcp':
			return orgResourcePath(input.orgSlug, 'mcp-servers', 'new')
		default: {
			const exhaustive: never = input.kind
			return exhaustive
		}
	}
}

/**
 * The org credential the form would replace: same name, not package-scoped.
 * Url, login, and signing credentials share the Key namespace.
 */
export function findExistingOrgKey(
	credentials: ReadonlyArray<CredentialListItem>,
	name: string,
) {
	const wanted = name.trim()
	if (!wanted) return null
	return (
		credentials.find(
			(credential) =>
				isValueFormKind(credential.kind) &&
				credential.scope === 'org' &&
				credential.packageId === null &&
				credential.name === wanted,
		) ?? null
	)
}

/**
 * Credentials that may already satisfy the link: the same kind (when the link
 * names one) and, when the link names a provider, the same provider.
 */
export function findMatchingCredentials(
	credentials: ReadonlyArray<CredentialListItem>,
	query: Pick<ParsedCredentialCreateQuery, 'kind' | 'provider'>,
) {
	return credentials.filter(
		(credential) =>
			(query.kind === null || credential.kind === query.kind) &&
			query.provider !== null &&
			credential.provider === query.provider,
	)
}

/** Hosts typed one per line or separated by commas or spaces. */
export function parseHostsInput(text: string) {
	return [
		...new Set(
			text
				.split(/[\s,]+/)
				.map((host) => host.trim().toLowerCase())
				.filter(Boolean),
		),
	]
}

/**
 * The creation link's `loginExchange` param: the JSON `login_exchange` a
 * package's login need expects, so the person only types their login fields.
 */
export const loginExchangeParam = 'loginExchange'

export type LoginExchangeForm = {
	url: string
	bodyFormat: 'json' | 'form'
	/** The exchange body as JSON; `{field}` in a value is a login field. */
	body: string
	tokenPath: string
	/** Exchange fields the form does not edit (method, ttl, expiry path). */
	rest: Record<string, unknown>
}

const defaultLoginExchangeBody =
	'{"username":"{username}","password":"{password}"}'

function readLoginExchangeParam(
	passthrough: URLSearchParams,
): LoginExchangeForm {
	let parsed: unknown = null
	try {
		parsed = JSON.parse(passthrough.get(loginExchangeParam) ?? 'null')
	} catch {
		parsed = null
	}
	const record =
		parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {}
	const { url, bodyFormat, body, tokenPath, ...rest } = record
	return {
		url: typeof url === 'string' ? url : '',
		bodyFormat: bodyFormat === 'form' ? 'form' : 'json',
		body:
			body && typeof body === 'object'
				? JSON.stringify(body)
				: defaultLoginExchangeBody,
		tokenPath: typeof tokenPath === 'string' ? tokenPath : '',
		rest,
	}
}

export type KeyFormState = {
	name: string
	value: string
	description: string
	provider: string
	hosts: string
	expiresAt: string
	/** Replace the existing org credential with this name instead of failing. */
	replaceExisting: boolean
	/** Login field values by field name; only the `login` kind reads them. */
	loginFields: Record<string, string>
	loginExchange: LoginExchangeForm
}

export function createKeyFormState(
	query: ParsedCredentialCreateQuery,
): KeyFormState {
	return {
		name: query.name ?? '',
		value: '',
		description: query.description ?? '',
		provider: query.provider ?? '',
		hosts: query.allowedHosts.join('\n'),
		expiresAt: '',
		replaceExisting: false,
		loginFields: {},
		loginExchange: readLoginExchangeParam(query.passthrough),
	}
}

function parseExchangeBody(text: string): Record<string, string> | null {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		return null
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return null
	}
	const entries = Object.entries(parsed)
	return entries.every((entry) => typeof entry[1] === 'string')
		? Object.fromEntries(entries as Array<[string, string]>)
		: null
}

/**
 * The login fields the exchange body asks for (`{username}` and so on), in
 * order. Falls back to username and password while the body is not valid.
 */
export function loginFieldNames(exchange: LoginExchangeForm) {
	const body = parseExchangeBody(exchange.body)
	if (!body) return ['username', 'password']
	const names = Object.values(body).flatMap((value) =>
		[...value.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((match) => match[1]!),
	)
	return names.length > 0 ? [...new Set(names)] : ['username', 'password']
}

/** A login field holding a password or token is masked in the form. */
export function isMaskedLoginField(name: string) {
	return /pass|secret|token|key|pin|otp|code/i.test(name)
}

export type CredentialSaveBody =
	| { ok: true; body: Record<string, unknown> }
	| { ok: false; error: string }

/**
 * The `/account/secrets.json` save for the value form. Replacing a Key keeps
 * its hosts and adds the form's; the opt-in kinds take exactly the form's
 * hosts, because whoever types the value decides where it may go.
 */
export function buildKeySaveBody(input: {
	kind: ValueFormKind
	form: KeyFormState
	existing: CredentialListItem | null
}): CredentialSaveBody {
	const { form } = input
	const name = form.name.trim()
	const replacing = form.replaceExisting && input.existing !== null
	const hosts = parseHostsInput(form.hosts)
	const common = {
		action: 'save',
		currentId: replacing ? buildAccountSecretId({ name, scope: 'user' }) : null,
		name,
		scope: 'user',
		description: form.description.trim(),
		provider: form.provider.trim() || null,
		expiresAt: form.expiresAt.trim() || null,
		allowedPackages: replacing
			? (input.existing?.lockedToPackageIds ?? [])
			: [],
	}
	switch (input.kind) {
		case 'secret':
			return {
				ok: true,
				body: {
					...common,
					value: form.value,
					allowedHosts: replacing
						? [...new Set([...(input.existing?.hosts ?? []), ...hosts])]
						: hosts,
				},
			}
		case 'url':
		case 'signing':
			return {
				ok: true,
				body: {
					...common,
					kind: input.kind,
					value: form.value.trim(),
					hosts,
					allowedHosts: [],
				},
			}
		case 'login': {
			const body = parseExchangeBody(form.loginExchange.body)
			if (!body) {
				return {
					ok: false,
					error:
						'The exchange body must be a JSON object of text values, for example {"username":"{username}"}.',
				}
			}
			const fields = Object.fromEntries(
				loginFieldNames(form.loginExchange).map((field) => [
					field,
					form.loginFields[field] ?? '',
				]),
			)
			return {
				ok: true,
				body: {
					...common,
					kind: 'login',
					value: JSON.stringify(fields),
					hosts,
					allowedHosts: [],
					loginExchange: {
						...form.loginExchange.rest,
						url: form.loginExchange.url.trim(),
						bodyFormat: form.loginExchange.bodyFormat,
						body,
						tokenPath: form.loginExchange.tokenPath.trim(),
					},
				},
			}
		}
		default: {
			const exhaustive: never = input.kind
			return exhaustive
		}
	}
}

/** A prompt the person can hand their agent when a save fails. */
export function credentialCreateAgentPrompt(input: {
	kind: CredentialKind
	query: ParsedCredentialCreateQuery
	pageUrl: string
	error: string
}) {
	const label = credentialKindLabel(input.kind)
	const name = input.query.name ? ` named "${input.query.name}"` : ''
	const forPackage =
		input.query.packageKodyId && input.query.needKey
			? ` for the "${input.query.needKey}" need of package ${input.query.packageKodyId}`
			: ''
	return [
		`I tried to save a ${label} credential${name}${forPackage} on Kody: ${input.pageUrl}`,
		`Kody said: ${input.error}`,
		`Help me fix the link or the form. Do not ask me to paste the value into chat.`,
	].join('\n')
}
