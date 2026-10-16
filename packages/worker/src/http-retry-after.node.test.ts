import { expect, test } from 'vitest'
import { jsonResponse } from '#worker/json-response.ts'
import { ApiError, apiErrorResponse } from '#worker/open-api/errors.ts'
import {
	defaultRetryAfterSeconds,
	ensureRetryAfterHeader,
} from './http-retry-after.ts'

test('ensureRetryAfterHeader only fills missing 429 Retry-After', () => {
	const headers = new Headers()
	ensureRetryAfterHeader(headers, 200)
	expect(headers.has('Retry-After')).toBe(false)
	ensureRetryAfterHeader(headers, 429)
	expect(headers.get('Retry-After')).toBe(String(defaultRetryAfterSeconds))
	headers.set('Retry-After', '120')
	ensureRetryAfterHeader(headers, 429, 60)
	expect(headers.get('Retry-After')).toBe('120')
})

test('jsonResponse adds Retry-After on bare 429 status', () => {
	const response = jsonResponse({ ok: false }, 429)
	expect(response.status).toBe(429)
	expect(response.headers.get('Retry-After')).toBe(
		String(defaultRetryAfterSeconds),
	)
})

test('apiErrorResponse adds Retry-After for entitlement 429', () => {
	const response = apiErrorResponse(
		new ApiError({
			status: 429,
			code: 'entitlement_limit',
			message: 'Monthly compute used up.',
		}),
	)
	expect(response.status).toBe(429)
	expect(response.headers.get('Retry-After')).toBe(
		String(defaultRetryAfterSeconds),
	)
})
