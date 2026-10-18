/**
 * Observe mode: fills still succeed, but would-block is logged when a
 * placeholder site is outside the credential's stored placement.
 */
import { ownerIdFromStored } from '@kody-internal/shared/owner-person-ids.ts'
import { expect, test, vi } from 'vitest'
import { expandSecretPlaceholders } from '#mcp/fetch-gateway.ts'
import * as secretService from '#mcp/secrets/service.ts'
import * as credentialResolver from '#worker/credentials/credential-resolver.ts'
import * as orgsRepo from '#worker/orgs/repo.ts'
import { sessionRequestContext } from '#worker/test-support/request-context.ts'

const env = {
	APP_DB: {
		prepare() {
			return {
				bind() {
					return {
						async run() {
							return { meta: { changes: 0 } }
						},
						async first() {
							return null
						},
						async all() {
							return { results: [] }
						},
					}
				},
			}
		},
	},
	SECRET_STORE_KEY: 'test-secret-store-key-32-chars-minimum',
	SENTRY_ENVIRONMENT: 'test',
} as unknown as Env

const props = {
	baseUrl: 'https://example.com',
	userId: ownerIdFromStored('user-123'),
	email: null,
	request: sessionRequestContext('user-123', 'ada'),
	storageContext: null,
}

function mockSecret(placement: secretService.ResolvedSecret['placement']) {
	const secret: secretService.ResolvedSecret = {
		credentialId: 'cred-apiKey',
		found: true,
		value: 'sk_live',
		scope: 'user',
		allowedHosts: ['api.example.com'],
		allowedPackages: [],
		placement,
	}
	const { value: _value, ...found } = secret
	return {
		secret,
		findSpy: vi.spyOn(secretService, 'findSecretForUse').mockResolvedValue({
			found,
			readValue: async () => secret,
		}),
		authSpy: vi
			.spyOn(credentialResolver, 'authorizeActorUse')
			.mockResolvedValue(undefined),
		orgSpy: vi
			.spyOn(orgsRepo, 'loadOrgBindingForOrg')
			.mockResolvedValue({ orgId: ownerIdFromStored('user-123') } as never),
	}
}

test('headers-only placement still fills body but logs would-block', async () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const { findSpy, authSpy, orgSpy } = mockSecret({ headers: true })
	try {
		const { request: expanded, bodyFillDone } = await expandSecretPlaceholders({
			request: new Request('https://api.example.com/v1', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer {{secret:apiKey}}',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ token: '{{secret:apiKey}}' }),
			}),
			props,
			env,
		})
		expect(expanded.headers.get('Authorization')).toBe('Bearer sk_live')
		if (expanded.body) {
			expect(JSON.parse(await expanded.clone().text())).toEqual({
				token: 'sk_live',
			})
		}
		await bodyFillDone
		expect(info).toHaveBeenCalledWith(
			'credential-fill-placement-would-block',
			expect.objectContaining({
				credentialName: 'apiKey',
				part: 'body',
				allowedParts: ['headers'],
				surface: 'placeholder',
			}),
		)
		expect(info).not.toHaveBeenCalledWith(
			'credential-fill-placement-would-block',
			expect.objectContaining({ part: expect.stringContaining('header') }),
		)
	} finally {
		info.mockRestore()
		findSpy.mockRestore()
		authSpy.mockRestore()
		orgSpy.mockRestore()
	}
})

test('path and query fills are observed as distinct sites', async () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const { findSpy, authSpy, orgSpy } = mockSecret({ headers: true })
	try {
		const { request: expanded, bodyFillDone } = await expandSecretPlaceholders({
			request: new Request(
				'https://api.example.com/{{secret:apiKey}}?q={{secret:apiKey}}',
				{
					headers: { Authorization: 'Bearer {{secret:apiKey}}' },
				},
			),
			props,
			env,
		})
		expect(expanded.headers.get('Authorization')).toBe('Bearer sk_live')
		expect(new URL(expanded.url).pathname).toContain('sk_live')
		expect(new URL(expanded.url).searchParams.get('q')).toBe('sk_live')
		await bodyFillDone
		expect(info).toHaveBeenCalledWith(
			'credential-fill-placement-would-block',
			expect.objectContaining({ part: 'path' }),
		)
		expect(info).toHaveBeenCalledWith(
			'credential-fill-placement-would-block',
			expect.objectContaining({ part: 'query' }),
		)
	} finally {
		info.mockRestore()
		findSpy.mockRestore()
		authSpy.mockRestore()
		orgSpy.mockRestore()
	}
})

test('null placement (anywhere) does not log would-block', async () => {
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const { findSpy, authSpy, orgSpy } = mockSecret(null)
	try {
		const { request: expanded, bodyFillDone } = await expandSecretPlaceholders({
			request: new Request('https://api.example.com/v1', {
				method: 'POST',
				headers: {
					Authorization: 'Bearer {{secret:apiKey}}',
					'Content-Type': 'text/plain',
				},
				body: 'token={{secret:apiKey}}',
			}),
			props,
			env,
		})
		expect(expanded.headers.get('Authorization')).toBe('Bearer sk_live')
		expect(await expanded.text()).toBe('token=sk_live')
		await bodyFillDone
		expect(info).not.toHaveBeenCalledWith(
			'credential-fill-placement-would-block',
			expect.anything(),
		)
	} finally {
		info.mockRestore()
		findSpy.mockRestore()
		authSpy.mockRestore()
		orgSpy.mockRestore()
	}
})
