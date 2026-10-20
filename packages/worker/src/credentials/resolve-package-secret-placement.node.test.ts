import { expect, test, vi } from 'vitest'
import { defaultNewCredentialFillPlacement } from './fill-placement.ts'
import {
	isUntouchedDefaultPlacement,
	resolvePackageSecretPlacement,
} from './resolve-package-secret-placement.ts'

vi.mock('./package-manifest-fill-placement.ts', () => ({
	readDeclaredPackageSecretFillPlacement: vi.fn(),
}))

const { readDeclaredPackageSecretFillPlacement } =
	await import('./package-manifest-fill-placement.ts')
const readDeclared = vi.mocked(readDeclaredPackageSecretFillPlacement)

test('isUntouchedDefaultPlacement allows repair for unread and undeclared defaults', () => {
	expect(
		isUntouchedDefaultPlacement(defaultNewCredentialFillPlacement, null),
	).toBe(true)
	expect(
		isUntouchedDefaultPlacement(
			defaultNewCredentialFillPlacement,
			'default_unread',
		),
	).toBe(true)
	expect(
		isUntouchedDefaultPlacement(
			defaultNewCredentialFillPlacement,
			'default_undeclared',
		),
	).toBe(true)
	expect(
		isUntouchedDefaultPlacement(defaultNewCredentialFillPlacement, 'owner'),
	).toBe(false)
	expect(
		isUntouchedDefaultPlacement(defaultNewCredentialFillPlacement, 'manifest'),
	).toBe(false)
	expect(
		isUntouchedDefaultPlacement(defaultNewCredentialFillPlacement, 'explicit'),
	).toBe(false)
	expect(
		isUntouchedDefaultPlacement(
			{ headers: true, body: true },
			'default_unread',
		),
	).toBe(false)
	expect(isUntouchedDefaultPlacement(null, 'default_unread')).toBe(false)
})

test('resolvePackageSecretPlacement maps applied undeclared and unread', async () => {
	readDeclared.mockResolvedValueOnce({
		status: 'applied',
		placement: { body: true },
	})
	await expect(
		resolvePackageSecretPlacement({
			env: {} as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'token',
		}),
	).resolves.toEqual({
		placement: { body: true },
		origin: 'manifest',
		declarationStatus: 'applied',
	})

	readDeclared.mockResolvedValueOnce({ status: 'undeclared' })
	await expect(
		resolvePackageSecretPlacement({
			env: {} as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'token',
		}),
	).resolves.toEqual({
		placement: defaultNewCredentialFillPlacement,
		origin: 'default_undeclared',
		declarationStatus: 'undeclared',
	})

	readDeclared.mockResolvedValueOnce({
		status: 'unread',
		reason: 'manifest_load_failed',
	})
	await expect(
		resolvePackageSecretPlacement({
			env: {} as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'token',
		}),
	).resolves.toEqual({
		placement: defaultNewCredentialFillPlacement,
		origin: 'default_unread',
		declarationStatus: 'unread',
		unreadReason: 'manifest_load_failed',
	})
})
