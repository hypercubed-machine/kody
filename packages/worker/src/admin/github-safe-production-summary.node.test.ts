import { expect, test } from 'vitest'
import {
	formatOwnerConcentrationForGitHub,
	opaqueProductionRef,
	summarizeOwnerConcentrationForGitHub,
} from './github-safe-production-summary.ts'

test('summarizeOwnerConcentrationForGitHub returns counts only (no handles)', () => {
	const summary = summarizeOwnerConcentrationForGitHub([
		'@jane/notes',
		'@jane/calendar',
		'@acme/inbox',
		'@jane/todo',
		'not-scoped',
		'@acme/board',
	])
	expect(summary).toEqual({
		ownerCount: 2,
		packageCount: 5,
		topOwnerPackageCount: 3,
	})
	const text = formatOwnerConcentrationForGitHub(summary)
	expect(text).toBe('2 owners, top owner has 3 packages')
	expect(
		formatOwnerConcentrationForGitHub({
			ownerCount: 1,
			packageCount: 1,
			topOwnerPackageCount: 1,
		}),
	).toBe('1 owner, top owner has 1 package')
	expect(text).not.toMatch(/@jane|@acme|notes|calendar|inbox/)
	expect(JSON.stringify(summary)).not.toMatch(/jane|acme|notes/)
})

test('formatOwnerConcentrationForGitHub handles empty input', () => {
	expect(
		formatOwnerConcentrationForGitHub(summarizeOwnerConcentrationForGitHub([])),
	).toBe('0 owners')
})

test('opaqueProductionRef is stable and does not echo the input', async () => {
	const first = await opaqueProductionRef('@jane/private-notes')
	const second = await opaqueProductionRef('@jane/private-notes')
	expect(first).toBe(second)
	expect(first).toMatch(/^ref_[0-9a-f]{8}$/)
	expect(first).not.toContain('jane')
	expect(first).not.toContain('private')
	expect(first).not.toContain('notes')
	expect(await opaqueProductionRef('@acme/other')).not.toBe(first)
})
