import { buildAccountSecretId } from '@kody-internal/shared/account-secret-route.ts'
import { normalizeSecretExpiresAt } from '@kody-internal/shared/secret-expires-at.ts'
import {
	type CredentialKind,
	type CredentialListItem,
	type ParsedCredentialCreateQuery,
} from '#universal/credential-contracts.ts'
import { credentialKindLabel } from '#universal/credentials-list.ts'
import { orgResourcePath } from '#universal/org-pages.ts'
import { routes } from '#universal/routes.ts'

/**
 * How the one-pager creates each kind: a Key form on the page, a hand-off to
 * the existing OAuth or MCP flow, or not on the website yet. The website save
 * does not take `kind`, `hosts`, or `login_exchange`, and `secretSet` only
 * changes a kind together with its value, so the opt-in kinds have no
 * website path that keeps the value out of an agent's hands.
 */
export type CredentialCreateMode = 'key-form' | 'handoff' | 'unavailable'

export function credentialCreateMode(
	kind: CredentialKind,
): CredentialCreateMode {
	switch (kind) {
		case 'secret':
			return 'key-form'
		case 'oauth':
		case 'mcp':
			return 'handoff'
		case 'url':
		case 'login':
		case 'signing':
			return 'unavailable'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
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
 * The org Key the form would replace: same name and, for a package Key, the
 * same package (`packageId` null means not package-scoped).
 */
export function findExistingOrgKey(
	credentials: ReadonlyArray<CredentialListItem>,
	name: string,
	packageId: string | null = null,
) {
	const wanted = name.trim()
	if (!wanted) return null
	return (
		credentials.find(
			(credential) =>
				credential.scope === 'org' &&
				credential.packageId === packageId &&
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

/** Who can read a Key: any package the locks allow, or one package only. */
export type KeyPackageScope = 'org' | 'package'

export type KeyFormState = {
	name: string
	value: string
	description: string
	provider: string
	hosts: string
	/** YYYY-MM-DD from the date field, or a link's full UTC timestamp. */
	expiresAt: string
	packageScope: KeyPackageScope
	/** The package a package Key belongs to. */
	packageId: string
	/** Saved package ids an org Key is locked to; empty means any package. */
	allowedPackages: Array<string>
	/** Replace the existing org Key with this name instead of failing. */
	replaceExisting: boolean
}

/** A link's `expiresAt` as canonical UTC ISO, null when absent, or 'invalid'. */
export function readLinkExpiresAt(raw: string | null): string | null {
	if (!raw) return null
	try {
		return normalizeSecretExpiresAt(raw) ?? null
	} catch {
		return 'invalid'
	}
}

/** The date field's value for a stored expiry (date part of the timestamp). */
export function expiresAtDateValue(expiresAt: string) {
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(expiresAt.trim())
	return match?.[1] ?? ''
}

/** True when the expiry carries a time of day the date field cannot show. */
export function expiresAtHasTime(expiresAt: string) {
	const text = expiresAt.trim()
	return text.length > 10 && !text.endsWith('T00:00:00.000Z')
}

export function createKeyFormState(
	query: ParsedCredentialCreateQuery,
): KeyFormState {
	const expiresAt = readLinkExpiresAt(query.expiresAt)
	const packageKey =
		query.packageScopedTo !== null || query.packageScopeMissingId
	return {
		name: query.name ?? '',
		value: '',
		description: query.description ?? '',
		provider: query.provider ?? '',
		hosts: query.allowedHosts.join('\n'),
		expiresAt: expiresAt === 'invalid' ? '' : (expiresAt ?? ''),
		packageScope: packageKey ? 'package' : 'org',
		packageId: query.packageScopedTo ?? '',
		allowedPackages: packageKey ? [] : [...query.allowedPackages],
		replaceExisting: false,
	}
}

/**
 * What is wrong with the link itself, so the form cannot save it as asked.
 * Matches the legacy intake page: a bad expiry or a package Key for a
 * package this org does not have.
 */
export function keyLinkProblem(input: {
	query: ParsedCredentialCreateQuery
	packages: ReadonlyArray<{ id: string }>
}): string | null {
	if (readLinkExpiresAt(input.query.expiresAt) === 'invalid') {
		return 'This link has an invalid expiresAt value. Use a UTC timestamp or YYYY-MM-DD.'
	}
	if (input.query.packageScopeMissingId) {
		return 'This link asks for a package key but names no package (packageId).'
	}
	const packageId = input.query.packageScopedTo
	if (packageId && !input.packages.some((entry) => entry.id === packageId)) {
		return 'This link names a package that is not in this org.'
	}
	return null
}

/** Why the form cannot save yet, before posting. */
export function keyFormProblem(state: KeyFormState): string | null {
	if (state.packageScope === 'package' && !state.packageId) {
		return 'Choose the package this key belongs to.'
	}
	return null
}

/** The package a package Key belongs to, or null for an org Key. */
export function keyFormPackageId(state: KeyFormState) {
	return state.packageScope === 'package' ? state.packageId || null : null
}

/**
 * The `/account/secrets.json` save for the Key form. Replacing keeps the
 * existing Key's hosts and package locks and adds the form's; an empty
 * expiry keeps the existing one.
 */
export function buildKeySaveBody(input: {
	form: KeyFormState
	existing: CredentialListItem | null
}) {
	const name = input.form.name.trim()
	const replacing = input.form.replaceExisting && input.existing !== null
	const hosts = parseHostsInput(input.form.hosts)
	const packageId = keyFormPackageId(input.form)
	const scope = packageId ? 'package' : 'user'
	const allowedPackages = packageId
		? []
		: [
				...new Set([
					...(replacing ? (input.existing?.lockedToPackageIds ?? []) : []),
					...input.form.allowedPackages,
				]),
			].sort((left, right) => left.localeCompare(right))
	return {
		action: 'save',
		currentId: replacing
			? buildAccountSecretId({ name, scope, packageId })
			: null,
		name,
		scope,
		packageId,
		value: input.form.value,
		description: input.form.description.trim(),
		provider: input.form.provider.trim() || null,
		expiresAt:
			input.form.expiresAt.trim() ||
			(replacing ? (input.existing?.expiresAt ?? null) : null),
		allowedHosts: replacing
			? [...new Set([...(input.existing?.hosts ?? []), ...hosts])]
			: hosts,
		allowedPackages,
	}
}

/** A prompt the person can hand their agent when the website cannot help. */
export function credentialCreateAgentPrompt(input: {
	kind: CredentialKind
	query: ParsedCredentialCreateQuery
	pageUrl: string
}) {
	const label = credentialKindLabel(input.kind)
	const name = input.query.name ? ` named "${input.query.name}"` : ''
	const forPackage =
		input.query.packageKodyId && input.query.needKey
			? ` for the "${input.query.needKey}" need of package ${input.query.packageKodyId}`
			: ''
	return [
		`I opened a Kody credential link that asks for a ${label} credential${name}${forPackage}: ${input.pageUrl}`,
		`The website cannot create a ${label} credential yet.`,
		`Suggest another way to meet this need without me pasting the value into chat, or tell me which credential I already have that fits.`,
	].join('\n')
}
