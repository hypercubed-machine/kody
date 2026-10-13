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
	expiresAtDateValue,
	expiresAtHasTime,
	findMatchingCredentials,
	keyFormProblem,
	keyLinkProblem,
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

test('the website creates Keys, hands off OAuth and MCP, and says the rest are unavailable', () => {
	expect(
		Object.fromEntries(
			credentialKinds.map((kind) => [kind, credentialCreateMode(kind)]),
		),
	).toEqual({
		secret: 'key-form',
		oauth: 'handoff',
		mcp: 'handoff',
		url: 'unavailable',
		login: 'unavailable',
		signing: 'unavailable',
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
		packageScope: 'org',
		packageId: '',
		allowedPackages: [],
		replaceExisting: false,
	})
	expect(
		buildKeySaveBody({
			form: { ...form, value: 'sk-1', hosts: 'API.openai.com, x.dev\nx.dev' },
			existing: null,
		}),
	).toEqual({
		action: 'save',
		currentId: null,
		name: 'OPENAI_API_KEY',
		scope: 'user',
		packageId: null,
		value: 'sk-1',
		description: 'For summaries',
		provider: 'openai',
		expiresAt: null,
		allowedHosts: ['api.openai.com', 'x.dev'],
		allowedPackages: [],
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
	expect(buildKeySaveBody({ form, existing })).toMatchObject({
		currentId: 'user::::OPENAI_API_KEY',
		allowedHosts: ['api.openai.com', 'x.dev'],
		allowedPackages: ['pkg-1'],
	})
})

test('package Keys, expiry, and package locks come from the link and save like the legacy intake', () => {
	const packageForm = createKeyFormState(
		query('name=TOKEN&scope=package&packageId=pkg-1&expiresAt=2026-12-31'),
	)
	expect(packageForm).toMatchObject({
		packageScope: 'package',
		packageId: 'pkg-1',
		expiresAt: '2026-12-31T00:00:00.000Z',
		allowedPackages: [],
	})
	expect(expiresAtDateValue(packageForm.expiresAt)).toBe('2026-12-31')
	expect(expiresAtHasTime(packageForm.expiresAt)).toBe(false)
	expect(expiresAtHasTime('2026-12-31T15:30:00.000Z')).toBe(true)
	expect(
		buildKeySaveBody({
			form: { ...packageForm, value: 'v', allowedPackages: ['pkg-9'] },
			existing: null,
		}),
	).toMatchObject({
		scope: 'package',
		packageId: 'pkg-1',
		expiresAt: '2026-12-31T00:00:00.000Z',
		allowedPackages: [],
	})

	const lockedForm = createKeyFormState(
		query('name=TOKEN&allowedPackages=pkg-2,pkg-1'),
	)
	expect(lockedForm).toMatchObject({
		packageScope: 'org',
		allowedPackages: ['pkg-2', 'pkg-1'],
	})
	expect(
		buildKeySaveBody({ form: { ...lockedForm, value: 'v' }, existing: null }),
	).toMatchObject({
		scope: 'user',
		packageId: null,
		allowedPackages: ['pkg-1', 'pkg-2'],
	})

	const packageKey = credential({
		id: 'p1',
		name: 'TOKEN',
		packageId: 'pkg-1',
		expiresAt: '2027-01-01T00:00:00.000Z',
	})
	const orgKey = credential({ id: 'o1', name: 'TOKEN' })
	expect(findExistingOrgKey([orgKey, packageKey], 'TOKEN', 'pkg-1')).toBe(
		packageKey,
	)
	expect(findExistingOrgKey([orgKey, packageKey], 'TOKEN')).toBe(orgKey)
	expect(
		buildKeySaveBody({
			form: {
				...createKeyFormState(query('name=TOKEN&packageId=pkg-1')),
				value: 'v',
				replaceExisting: true,
			},
			existing: packageKey,
		}),
	).toMatchObject({
		currentId: 'package::pkg-1::TOKEN',
		expiresAt: '2027-01-01T00:00:00.000Z',
	})
})

test('a link the form cannot honor says why, and a package Key needs its package', () => {
	const packages = [{ id: 'pkg-1' }]
	const problem = (search: string) =>
		keyLinkProblem({ query: query(search), packages })
	expect(problem('name=x&packageId=pkg-1&expiresAt=2026-12-31')).toBeNull()
	expect(problem('expiresAt=soon')).toContain('invalid expiresAt')
	expect(createKeyFormState(query('expiresAt=soon')).expiresAt).toBe('')
	expect(problem('scope=package')).toContain('names no package')
	expect(problem('packageId=pkg-404')).toContain('not in this org')
	expect(
		keyFormProblem({
			...createKeyFormState(query('name=x')),
			packageScope: 'package',
		}),
	).toBe('Choose the package this key belongs to.')
	expect(keyFormProblem(createKeyFormState(query('name=x')))).toBeNull()
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

test('the agent prompt names the kind, credential, need, and link', () => {
	expect(
		credentialCreateAgentPrompt({
			kind: 'url',
			query: query('kind=url&name=BOT_URL&forPackage=bot&need=telegram'),
			pageUrl: 'https://kody.codes/connect/credential?kind=url',
		}),
	).toBe(
		[
			'I opened a Kody credential link that asks for a URL credential named "BOT_URL" for the "telegram" need of package bot: https://kody.codes/connect/credential?kind=url',
			'The website cannot create a URL credential yet.',
			'Suggest another way to meet this need without me pasting the value into chat, or tell me which credential I already have that fits.',
		].join('\n'),
	)
})
