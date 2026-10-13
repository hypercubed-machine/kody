import { DatabaseSync } from 'node:sqlite'
import {
	ownerIdFromStored,
	personIdFromStored,
} from '@kody-internal/shared/owner-person-ids.ts'
import { expect, test } from 'vitest'
import { createOrg, upsertGrant } from '#worker/orgs/access-writes.ts'
import { insertSavedPackage } from '#worker/package-registry/repo.ts'
import { insertEntitySource } from '#worker/repo/entity-sources.ts'
import { resolveGitHttpTargetAccess } from '#worker/repo/git-http-target.ts'
import { applyAllMigrations } from '#worker/test-support/apply-all-migrations.ts'
import { createTestOrgAuditWriter } from '#worker/test-support/create-audit-db.ts'
import { createD1FromSqlite } from '#worker/test-support/create-d1-from-sqlite.ts'
import { provisionPersonalOrgForSqliteUser } from '#worker/test-support/personal-org-seed.ts'
import { testStableUserIdFromEmail } from '#worker/test-support/stable-user-id.ts'

const migrationsDirectory = new URL('../../migrations/', import.meta.url)

/**
 * One user-owned `kody_at_…` (git HTTPS) must authorize every `@owner/name`
 * the person can access across orgs — not only the org chosen at `kody login`.
 */
test('resolveGitHttpTargetAccess: one user token reads packages in two orgs', async () => {
	const sqlite = new DatabaseSync(':memory:')
	applyAllMigrations(sqlite, migrationsDirectory)
	const db = createD1FromSqlite(sqlite)
	const env = { APP_DB: db } as unknown as Env

	const seedPerson = async (username: string) => {
		const id = testStableUserIdFromEmail(`${username}@example.com`)
		sqlite
			.prepare(
				`INSERT INTO users (username, email, password_hash, stable_user_id)
				 VALUES (?, ?, 'hash', ?)`,
			)
			.run(username, `${username}@example.com`, id)
		await provisionPersonalOrgForSqliteUser(sqlite, {
			stableUserId: id,
			username,
		})
		return id
	}

	const adaId = await seedPerson('ada')
	const teammateId = await seedPerson('teammate')
	const strangerId = await seedPerson('stranger')

	const teammateAudit = createTestOrgAuditWriter({ actorUserId: teammateId })

	// Org 1: Ada's personal org (`@ada`). Org 2: teammate's team that Ada can
	// access via a package grant (membership would also work). Free-org cap is 2.
	const teamOrg = await createOrg({
		db,
		env: {} as Env,
		slug: 'beta-co',
		displayName: 'Beta Co',
		createdByUserId: teammateId,
		audit: teammateAudit,
	})

	const insertPkg = async (input: {
		ownerId: string
		scope: string
		leaf: string
	}) => {
		const packageId = crypto.randomUUID()
		const sourceId = crypto.randomUUID()
		const now = '2026-10-13T00:00:00.000Z'
		await insertSavedPackage(
			db,
			{
				id: packageId,
				user_id: ownerIdFromStored(input.ownerId),
				name: `@${input.scope}/${input.leaf}`,
				kody_id: input.leaf,
				description: input.leaf,
				tags_json: '[]',
				search_text: null,
				source_id: sourceId,
				has_app: 0,
				has_skills: 0,
				hidden: 0,
				is_private: 1,
			},
			null,
			{ stamp: false },
		)
		await insertEntitySource(db, {
			id: sourceId,
			user_id: ownerIdFromStored(input.ownerId),
			entity_kind: 'package',
			entity_id: packageId,
			repo_id: `package-${packageId}`,
			published_commit: 'commit-1',
			indexed_commit: 'commit-1',
			manifest_path: 'package.json',
			source_root: '/',
			last_external_check_at: null,
			external_check_until: null,
			created_at: now,
			updated_at: now,
		})
		return packageId
	}

	const pkgPersonal = await insertPkg({
		ownerId: adaId,
		scope: 'ada',
		leaf: 'lights',
	})
	const pkgTeam = await insertPkg({
		ownerId: teamOrg.id,
		scope: 'beta-co',
		leaf: 'widgets',
	})
	await insertPkg({
		ownerId: strangerId,
		scope: 'stranger',
		leaf: 'secret',
	})

	await upsertGrant({
		db,
		orgId: teamOrg.id,
		resourceType: 'package',
		resourceId: pkgTeam,
		subject: { type: 'user', id: adaId },
		preset: null,
		permissions: ['package:read', 'package:write', 'package:execute'],
		createdByUserId: teammateId,
		audit: teammateAudit,
	})

	const viewer = {
		userId: personIdFromStored(adaId),
		username: 'ada',
	}
	// Scopes on a user-owned setup-git token — no org_id binding involved.
	const scopes = ['package:read', 'package:write'] as const

	const fromPersonal = await resolveGitHttpTargetAccess({
		env,
		viewer,
		ownerHandle: 'ada',
		repoName: 'lights',
		scopes: [...scopes],
		needWrite: false,
	})
	expect(fromPersonal).toMatchObject({
		ownerHandle: 'ada',
		repoName: 'lights',
		resourceKind: 'package',
		resourceId: pkgPersonal,
		resourceOrgId: ownerIdFromStored(adaId),
		canRead: true,
		canWrite: true,
	})

	const fromTeam = await resolveGitHttpTargetAccess({
		env,
		viewer,
		ownerHandle: 'beta-co',
		repoName: 'widgets',
		scopes: [...scopes],
		needWrite: false,
	})
	expect(fromTeam).toMatchObject({
		ownerHandle: 'beta-co',
		repoName: 'widgets',
		resourceKind: 'package',
		resourceId: pkgTeam,
		resourceOrgId: teamOrg.id,
		canRead: true,
		canWrite: true,
	})

	// Same token must not open a package Ada cannot access.
	const outsider = await resolveGitHttpTargetAccess({
		env,
		viewer,
		ownerHandle: 'stranger',
		repoName: 'secret',
		scopes: [...scopes],
		needWrite: false,
	})
	expect(outsider).toBeNull()
})
