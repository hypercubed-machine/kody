import { expect, test, vi } from 'vitest'
import { readDeclaredPackageSecretFillPlacement } from './package-manifest-fill-placement.ts'

vi.mock('#worker/package-registry/repo.ts', () => ({
	getSavedPackageById: vi.fn(),
}))
vi.mock('#worker/package-registry/source.ts', () => ({
	loadPackageManifestBySourceId: vi.fn(),
}))

const { getSavedPackageById } = await import('#worker/package-registry/repo.ts')
const { loadPackageManifestBySourceId } =
	await import('#worker/package-registry/source.ts')

const getSavedPackageByIdMock = vi.mocked(getSavedPackageById)
const loadPackageManifestBySourceIdMock = vi.mocked(
	loadPackageManifestBySourceId,
)

test('readDeclaredPackageSecretFillPlacement returns declared body placement', async () => {
	getSavedPackageByIdMock.mockResolvedValueOnce({
		id: 'pkg-1',
		sourceId: 'src-1',
	} as Awaited<ReturnType<typeof getSavedPackageById>>)
	loadPackageManifestBySourceIdMock.mockResolvedValueOnce({
		manifest: {
			kody: {
				credentials: {
					'refresh-token': {
						kind: 'secret',
						description: 'Refresh token for auth/token.',
						placement: { body: true },
					},
				},
			},
		},
	} as unknown as Awaited<ReturnType<typeof loadPackageManifestBySourceId>>)

	await expect(
		readDeclaredPackageSecretFillPlacement({
			env: { APP_DB: {} } as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'refresh-token',
		}),
	).resolves.toEqual({ status: 'applied', placement: { body: true } })
})

test('readDeclaredPackageSecretFillPlacement returns undeclared when no placement', async () => {
	getSavedPackageByIdMock.mockResolvedValueOnce({
		id: 'pkg-1',
		sourceId: 'src-1',
	} as Awaited<ReturnType<typeof getSavedPackageById>>)
	loadPackageManifestBySourceIdMock.mockResolvedValueOnce({
		manifest: {
			kody: {
				credentials: {
					'refresh-token': {
						kind: 'secret',
						description: 'Refresh token for auth/token.',
					},
				},
			},
		},
	} as unknown as Awaited<ReturnType<typeof loadPackageManifestBySourceId>>)

	await expect(
		readDeclaredPackageSecretFillPlacement({
			env: { APP_DB: {} } as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'refresh-token',
		}),
	).resolves.toEqual({ status: 'undeclared' })
})

test('readDeclaredPackageSecretFillPlacement returns unread on load failure', async () => {
	getSavedPackageByIdMock.mockRejectedValueOnce(new Error('db down'))
	await expect(
		readDeclaredPackageSecretFillPlacement({
			env: { APP_DB: {} } as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'refresh-token',
		}),
	).resolves.toEqual({ status: 'unread', reason: 'manifest_load_failed' })
})

test('readDeclaredPackageSecretFillPlacement returns unread when source is missing', async () => {
	getSavedPackageByIdMock.mockResolvedValueOnce({
		id: 'pkg-1',
		sourceId: null,
	} as unknown as Awaited<ReturnType<typeof getSavedPackageById>>)
	await expect(
		readDeclaredPackageSecretFillPlacement({
			env: { APP_DB: {} } as Env,
			userId: 'user-1' as never,
			baseUrl: 'https://kody.example',
			packageId: 'pkg-1',
			secretName: 'refresh-token',
		}),
	).resolves.toEqual({ status: 'unread', reason: 'package_source_missing' })
})
