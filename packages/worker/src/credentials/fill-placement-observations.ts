/**
 * Durable observe-mode records for fill placement: which request parts were
 * filled and which would have been blocked under the stored placement. Used by
 * the credential page and later auto-narrowing. Never enforces.
 */
import { waitUntil } from 'cloudflare:workers'

export type FillPlacementPartKey = 'headers' | 'query' | 'path' | 'body'

export type FillPlacementObservationView = {
	filledLastSeen: Partial<Record<FillPlacementPartKey, string>>
	wouldBlockLastSeen: Partial<Record<FillPlacementPartKey, string>>
	updatedAt: string
}

function readPartMap(json: string | null | undefined) {
	if (!json) return {} as Partial<Record<FillPlacementPartKey, string>>
	try {
		const parsed = JSON.parse(json) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {}
		}
		const out: Partial<Record<FillPlacementPartKey, string>> = {}
		for (const key of ['headers', 'query', 'path', 'body'] as const) {
			const value = (parsed as Record<string, unknown>)[key]
			if (typeof value === 'string' && value.length > 0) out[key] = value
		}
		return out
	} catch {
		return {}
	}
}

export async function readFillPlacementObservation(
	db: D1Database,
	credentialId: string,
): Promise<FillPlacementObservationView | null> {
	const row = await db
		.prepare(
			`SELECT filled_last_seen_json, would_block_last_seen_json, updated_at
			 FROM credential_fill_placement_observations
			 WHERE credential_id = ?`,
		)
		.bind(credentialId)
		.first<{
			filled_last_seen_json: string
			would_block_last_seen_json: string
			updated_at: string
		}>()
	if (!row) return null
	return {
		filledLastSeen: readPartMap(row.filled_last_seen_json),
		wouldBlockLastSeen: readPartMap(row.would_block_last_seen_json),
		updatedAt: row.updated_at,
	}
}

export async function recordFillPlacementObservation(input: {
	db: D1Database
	credentialId: string
	filledParts?: ReadonlyArray<FillPlacementPartKey>
	wouldBlockParts?: ReadonlyArray<FillPlacementPartKey>
	at?: string
}): Promise<void> {
	const credentialId = input.credentialId.trim()
	if (!credentialId) return
	const at = input.at ?? new Date().toISOString()
	const existing = await readFillPlacementObservation(input.db, credentialId)
	const filled = { ...existing?.filledLastSeen }
	const wouldBlock = { ...existing?.wouldBlockLastSeen }
	for (const part of input.filledParts ?? []) {
		filled[part] = at
	}
	for (const part of input.wouldBlockParts ?? []) {
		wouldBlock[part] = at
	}
	if (
		(input.filledParts?.length ?? 0) === 0 &&
		(input.wouldBlockParts?.length ?? 0) === 0
	) {
		return
	}
	await input.db
		.prepare(
			`INSERT INTO credential_fill_placement_observations (
				credential_id, filled_last_seen_json, would_block_last_seen_json, updated_at
			) VALUES (?, ?, ?, ?)
			ON CONFLICT(credential_id) DO UPDATE SET
				filled_last_seen_json = excluded.filled_last_seen_json,
				would_block_last_seen_json = excluded.would_block_last_seen_json,
				updated_at = excluded.updated_at`,
		)
		.bind(credentialId, JSON.stringify(filled), JSON.stringify(wouldBlock), at)
		.run()
}

/**
 * Schedule a durable observation write after the response path. Never throws.
 */
export function scheduleFillPlacementObservation(input: {
	env: Pick<Env, 'APP_DB'>
	credentialId: string | null | undefined
	filledParts?: ReadonlyArray<FillPlacementPartKey>
	wouldBlockParts?: ReadonlyArray<FillPlacementPartKey>
}): void {
	const credentialId = input.credentialId?.trim()
	if (!credentialId) return
	if (
		(input.filledParts?.length ?? 0) === 0 &&
		(input.wouldBlockParts?.length ?? 0) === 0
	) {
		return
	}
	waitUntil(
		recordFillPlacementObservation({
			db: input.env.APP_DB,
			credentialId,
			filledParts: input.filledParts,
			wouldBlockParts: input.wouldBlockParts,
		}).catch((error: unknown) => {
			console.error('credential-fill-placement-observation-failed', {
				credentialId,
				error: error instanceof Error ? error.message : String(error),
			})
		}),
	)
}
