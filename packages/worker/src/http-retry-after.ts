/**
 * Default `Retry-After` seconds when a 429 does not carry a more specific
 * window. Cloudflare Rate Limit bindings only return success/failure, so we
 * do not emit `RateLimit-*` headers — clients should honor `Retry-After`.
 */
export const defaultRetryAfterSeconds = 60

/** Ensure a 429 response includes `Retry-After` (seconds). */
export function ensureRetryAfterHeader(
	headers: Headers,
	status: number | undefined,
	seconds: number = defaultRetryAfterSeconds,
) {
	if (status !== 429) return
	if (headers.has('Retry-After')) return
	headers.set('Retry-After', String(seconds))
}
