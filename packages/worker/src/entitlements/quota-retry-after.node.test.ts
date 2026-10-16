import { expect, test } from 'vitest'
import {
	ComputeOverageLimitError,
	EntitlementLimitError,
	retryAfterSecondsForQuotaLimit,
} from './errors.ts'

test('quota Retry-After uses month reset for compute overage', () => {
	const now = new Date('2026-10-16T12:00:00.000Z')
	const error = new ComputeOverageLimitError({
		resource: 'unique_worker_days',
		plan: 'pro',
		limit: 350,
		current: 350,
		creditsStatus: 'add_credits',
	})
	const seconds = retryAfterSecondsForQuotaLimit(error, now)
	const expected = Math.ceil((Date.UTC(2026, 10, 1) - now.getTime()) / 1000)
	expect(seconds).toBe(expected)
	expect(seconds).toBeGreaterThan(60 * 60 * 24)
})

test('quota Retry-After uses day reset for utc_day entitlements', () => {
	const now = new Date('2026-10-16T12:00:00.000Z')
	const error = new EntitlementLimitError({
		resource: 'execute_unique_workers_per_day',
		plan: 'pro',
		limit: 10,
		current: 10,
		upgradeHint: 'Wait for reset.',
		window: 'day',
	})
	const seconds = retryAfterSecondsForQuotaLimit(error, now)
	expect(seconds).toBe(12 * 60 * 60)
})

test('quota Retry-After uses a long backoff for standing limits', () => {
	const error = new EntitlementLimitError({
		resource: 'saved_packages',
		plan: 'free',
		limit: 5,
		current: 5,
		upgradeHint: 'Remove a package.',
	})
	expect(retryAfterSecondsForQuotaLimit(error)).toBe(60 * 60)
})
