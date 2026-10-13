import { expect, test } from 'vitest'
import {
	type CredentialListItem,
	credentialKinds,
	parseCredentialCreateQuery,
} from '#universal/credential-contracts.ts'
import {
	buildKeySaveBody,
	createKeyFormState,
	credentialCreateAgentPrompt,
	credentialCreateHandoffHref,
	credentialCreateMode,
	findExistingOrgKey,
	findMatchingCredentials,
	isMaskedLoginField,
	loginFieldNames,
	parseHostsInput,
	writeCredentialCreateKind,
} from './connect-credential-shared.ts'

function credential(
	overrides: Partial<CredentialListItem> & { id: string; name: string },
): CredentialListItem {
	return {
		kind: 'secret',
		scope: 'org',
		provider: null,
		description: '',
		hosts: [],
		inject: null,
		packageId: null,
		lockedToPackageIds: [],
		expiresAt: null,
		createdAt: '2026-10-13T00:00:00.000Z',
		updatedAt: '2026-10-13T00:00:00.000Z',
		status: 'ok',
		statusMessage: null,
		mcp: null,
		...overrides,
	}
}

const query = (search: string) =>
	parseCredentialCreateQuery(new URLSearchParams(search))

test('the website takes a typed value for every kind but OAuth and MCP, which it hands off', () => {
	expect(
		Object.fromEntries(
			credentialKinds.map((kind) => [kind, credentialCreateMode(kind)]),
		),
	).toEqual({
		secret: 'value-form',
		oauth: 'handoff',
		mcp: 'handoff',
		url: 'value-form',
		login: 'value-form',
		signing: 'value-form',
	})
})

test('choosing a kind keeps the prefill, and hand-offs carry it on', () => {
	expect(
		writeCredentialCreateKind(
			'/connect/credential?kind=secret&name=x&forPackage=pr-digest&need=llm',
			'oauth',
		),
	).toBe('/connect/credential?kind=oauth&name=x&forPackage=pr-digest&need=llm')
	expect(
		credentialCreateHandoffHref({
			kind: 'oauth',
			search: new URLSearchParams('kind=oauth&provider=github&scopes=repo'),
			orgSlug: 'acme',
		}),
	).toBe('/connect/oauth?kind=oauth&provider=github&scopes=repo')
	expect(
		credentialCreateHandoffHref({
			kind: 'mcp',
			search: new URLSearchParams('kind=mcp'),
			orgSlug: 'acme',
		}),
	).toBe('/@acme/-/mcp-servers/new')
})

test('the Key form starts from the link and saves an org Key', () => {
	const form = createKeyFormState(
		query(
			'kind=secret&name=OPENAI_API_KEY&provider=openai&description=For+summaries&allowedHosts=api.openai.com,uploads.openai.com',
		),
	)
	expect(form).toEqual({
		name: 'OPENAI_API_KEY',
		value: '',
		description: 'For summaries',
		provider: 'openai',
		hosts: 'api.openai.com\nuploads.openai.com',
		expiresAt: '',
		replaceExisting: false,
		loginFields: {},
		loginExchange: {
			url: '',
			bodyFormat: 'json',
			body: '{"username":"{username}","password":"{password}"}',
			tokenPath: '',
			rest: {},
		},
	})
	expect(
		buildKeySaveBody({
			kind: 'secret',
			form: { ...form, value: 'sk-1', hosts: 'API.openai.com, x.dev\nx.dev' },
			existing: null,
		}),
	).toEqual({
		ok: true,
		body: {
			action: 'save',
			currentId: null,
			name: 'OPENAI_API_KEY',
			scope: 'user',
			value: 'sk-1',
			description: 'For summaries',
			provider: 'openai',
			expiresAt: null,
			allowedHosts: ['api.openai.com', 'x.dev'],
			allowedPackages: [],
		},
	})
})

test('replacing an existing Key keeps its hosts and package locks', () => {
	const existing = credential({
		id: 'k1',
		name: 'OPENAI_API_KEY',
		hosts: ['api.openai.com'],
		lockedToPackageIds: ['pkg-1'],
	})
	const credentials = [
		credential({ id: 'p1', name: 'OPENAI_API_KEY', packageId: 'pkg-2' }),
		credential({ id: 'm1', name: 'OPENAI_API_KEY', scope: 'personal' }),
		existing,
	]
	expect(findExistingOrgKey(credentials, ' OPENAI_API_KEY ')).toBe(existing)
	expect(findExistingOrgKey(credentials, '')).toBeNull()
	const form = {
		...createKeyFormState(query('name=OPENAI_API_KEY&allowedHosts=x.dev')),
		value: 'sk-2',
		replaceExisting: true,
	}
	expect(buildKeySaveBody({ kind: 'secret', form, existing })).toMatchObject({
		body: {
			currentId: 'user::::OPENAI_API_KEY',
			allowedHosts: ['api.openai.com', 'x.dev'],
			allowedPackages: ['pkg-1'],
		},
	})
	expect(
		findExistingOrgKey(
			[credential({ id: 'o1', name: 'gh', kind: 'oauth' })],
			'gh',
		),
	).toBeNull()
})

test('matches need a provider, and a kind when the link names one', () => {
	const credentials = [
		credential({ id: 'a', name: 'gh', kind: 'oauth', provider: 'github' }),
		credential({ id: 'b', name: 'GH_PAT', provider: 'github' }),
		credential({ id: 'c', name: 'other', kind: 'oauth', provider: 'linear' }),
	]
	const ids = (search: string) =>
		findMatchingCredentials(credentials, query(search)).map((item) => item.id)
	expect(ids('kind=oauth&provider=github')).toEqual(['a'])
	expect(ids('provider=github')).toEqual(['a', 'b'])
	expect(ids('kind=oauth')).toEqual([])
})

test('hosts accept lines, commas, and spaces', () => {
	expect(parseHostsInput(' a.dev,b.dev \n\nA.dev c.dev')).toEqual([
		'a.dev',
		'b.dev',
		'c.dev',
	])
})

test('url and signing saves send kind and exactly the typed hosts', () => {
	const existing = credential({
		id: 'u1',
		name: 'BOT_URL',
		kind: 'url',
		hosts: ['old.example.com'],
		lockedToPackageIds: ['pkg-1'],
	})
	const form = {
		...createKeyFormState(
			query('kind=url&name=BOT_URL&allowedHosts=hooks.example.com'),
		),
		value: ' https://hooks.example.com/abc ',
		replaceExisting: true,
	}
	expect(buildKeySaveBody({ kind: 'url', form, existing })).toEqual({
		ok: true,
		body: {
			action: 'save',
			currentId: 'user::::BOT_URL',
			name: 'BOT_URL',
			scope: 'user',
			kind: 'url',
			value: 'https://hooks.example.com/abc',
			hosts: ['hooks.example.com'],
			allowedHosts: [],
			allowedPackages: ['pkg-1'],
			description: '',
			provider: null,
			expiresAt: null,
		},
	})
	expect(
		buildKeySaveBody({ kind: 'signing', form, existing: null }),
	).toMatchObject({ ok: true, body: { kind: 'signing', currentId: null } })
})

test('a login save builds its value from the exchange body fields', () => {
	const exchange = {
		url: 'https://api.example.com/login',
		bodyFormat: 'form',
		body: { email: '{email}', pass: '{password}', client: 'kody' },
		tokenPath: 'data.token',
		ttlSeconds: 600,
	}
	const form = createKeyFormState(
		query(
			`kind=login&name=SITE&allowedHosts=api.example.com&loginExchange=${encodeURIComponent(JSON.stringify(exchange))}`,
		),
	)
	expect(loginFieldNames(form.loginExchange)).toEqual(['email', 'password'])
	expect(isMaskedLoginField('password')).toBe(true)
	expect(isMaskedLoginField('email')).toBe(false)
	const save = buildKeySaveBody({
		kind: 'login',
		form: {
			...form,
			loginFields: { email: 'me@x.dev', password: 'pw', extra: 'no' },
		},
		existing: null,
	})
	expect(save).toMatchObject({
		ok: true,
		body: {
			kind: 'login',
			value: JSON.stringify({ email: 'me@x.dev', password: 'pw' }),
			hosts: ['api.example.com'],
			loginExchange: exchange,
		},
	})
	expect(
		buildKeySaveBody({
			kind: 'login',
			form: { ...form, loginExchange: { ...form.loginExchange, body: '[1]' } },
			existing: null,
		}),
	).toMatchObject({ ok: false, error: expect.stringContaining('JSON object') })
	expect(loginFieldNames({ ...form.loginExchange, body: 'not json' })).toEqual([
		'username',
		'password',
	])
})

test('the agent prompt names the kind, credential, need, link, and error', () => {
	expect(
		credentialCreateAgentPrompt({
			kind: 'url',
			query: query('kind=url&name=BOT_URL&forPackage=bot&need=telegram'),
			pageUrl: 'https://kody.codes/connect/credential?kind=url',
			error: 'A url credential needs hosts.',
		}),
	).toBe(
		[
			'I tried to save a URL credential named "BOT_URL" for the "telegram" need of package bot on Kody: https://kody.codes/connect/credential?kind=url',
			'Kody said: A url credential needs hosts.',
			'Help me fix the link or the form. Do not ask me to paste the value into chat.',
		].join('\n'),
	)
})
