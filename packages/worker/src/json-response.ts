import { ensureRetryAfterHeader } from '#worker/http-retry-after.ts'
import {
	applyServerTimingHeader,
	type ServerTimingEntry,
} from '#worker/server-timing.ts'

type JsonResponseInit = ResponseInit & {
	serverTiming?: Array<ServerTimingEntry>
}

/**
 * Serialize a JSON API response. Accepts either a bare status code or a full
 * ResponseInit; Content-Type and Cache-Control get sensible defaults that
 * individual headers can override. Every 429 gets `Retry-After` when the
 * caller did not set one.
 */
export function jsonResponse(
	body: unknown,
	init: number | JsonResponseInit = 200,
) {
	const responseInit: JsonResponseInit =
		typeof init === 'number' ? { status: init } : init
	const { serverTiming, ...rest } = responseInit
	const headers = new Headers(rest.headers)
	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json; charset=utf-8')
	}
	if (!headers.has('Cache-Control')) {
		headers.set('Cache-Control', 'no-store')
	}
	ensureRetryAfterHeader(headers, rest.status ?? 200)
	applyServerTimingHeader(headers, serverTiming)
	return new Response(JSON.stringify(body), { ...rest, headers })
}
