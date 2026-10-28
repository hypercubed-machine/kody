import { DurableObject } from 'cloudflare:workers'

export const executionContextsUnavailableCode = 'execution_contexts_unavailable'

/**
 * Platform-owned session for one execution context connection. The class
 * exists so its Durable Object migration ships on its own; until the
 * feature lands it rejects every request (including WebSocket upgrades),
 * stores nothing, and sets no alarms.
 */
export class ExecutionContextSessionV1 extends DurableObject<Env> {
	async fetch(_request: Request): Promise<Response> {
		return Response.json(
			{
				ok: false,
				error: {
					code: executionContextsUnavailableCode,
					message: 'Execution contexts are not available.',
				},
			},
			{ status: 503, headers: { 'Cache-Control': 'no-store' } },
		)
	}
}
