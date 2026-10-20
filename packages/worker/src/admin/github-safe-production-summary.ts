/**
 * Helpers for public progress reports that must not leak private information
 * (principle: docs/principles/no-private-info-in-public.md). Emit counts,
 * aggregates, or opaque short refs — never usernames, org handles, package
 * names, emails, secrets, or internal IDs. Fleet/admin results that include
 * named rows (e.g. credential-stamp outcomes) should expose a counts-only
 * rollup built with these helpers for anything posted publicly.
 */
import { sha256Hex } from '@kody-internal/shared/sha256.ts'

const opaqueProductionRefPrefix = 'ref_'
const opaqueProductionRefHexLength = 8

export type GithubSafeOwnerConcentration = {
	ownerCount: number
	packageCount: number
	topOwnerPackageCount: number
}

/**
 * Opaque short ref for a private id or name. Stable for the same input; not
 * reversible to the original handle or package name.
 */
export async function opaqueProductionRef(value: string): Promise<string> {
	const hex = await sha256Hex(value.trim().toLowerCase())
	return `${opaqueProductionRefPrefix}${hex.slice(0, opaqueProductionRefHexLength)}`
}

/**
 * Owner concentration from scoped package names (`@owner/leaf`) without
 * returning any owner handle or package name. One application of the no-
 * private-info-in-public principle for fleet/admin progress posts.
 */
export function summarizeOwnerConcentrationForGitHub(
	packageNames: ReadonlyArray<string>,
): GithubSafeOwnerConcentration {
	const counts = new Map<string, number>()
	let packageCount = 0
	for (const packageName of packageNames) {
		const owner = ownerKeyFromScopedPackageName(packageName)
		if (!owner) continue
		packageCount += 1
		counts.set(owner, (counts.get(owner) ?? 0) + 1)
	}
	let topOwnerPackageCount = 0
	for (const count of counts.values()) {
		if (count > topOwnerPackageCount) topOwnerPackageCount = count
	}
	return {
		ownerCount: counts.size,
		packageCount,
		topOwnerPackageCount,
	}
}

/** Counts-only line, e.g. `3 owners, top owner has 2 packages`. */
export function formatOwnerConcentrationForGitHub(
	summary: GithubSafeOwnerConcentration,
): string {
	if (summary.ownerCount === 0) return '0 owners'
	const ownersLabel = summary.ownerCount === 1 ? 'owner' : 'owners'
	const packagesLabel =
		summary.topOwnerPackageCount === 1 ? 'package' : 'packages'
	return `${String(summary.ownerCount)} ${ownersLabel}, top owner has ${String(summary.topOwnerPackageCount)} ${packagesLabel}`
}

function ownerKeyFromScopedPackageName(packageName: string): string | null {
	const match = /^@([^/\s]+)\//.exec(packageName.trim())
	const owner = match?.[1]?.trim()
	return owner && owner.length > 0 ? owner : null
}
