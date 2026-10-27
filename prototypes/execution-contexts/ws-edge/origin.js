/* oxlint-disable no-undef -- Workers runtime globals; throwaway prototype */
import { WorkerEntrypoint } from 'cloudflare:workers'

const stub = (env, ecid) => env.EC_SESSION.get(env.EC_SESSION.idFromName(ecid))

async function handle(request, env) {
	const url = new URL(request.url)
	if (
		url.pathname === '/v1/execution-contexts/connect-ticket' &&
		request.method === 'POST'
	) {
		const { ecid } = await request.json()
		const ticket = `${ecid}.${crypto.randomUUID()}`
		const issued = await stub(env, ecid).issueTicket(ticket)
		return Response.json({ ticket, ...issued })
	}
	if (url.pathname === '/v1/execution-contexts/connect') {
		const ecid = (url.searchParams.get('ticket') ?? '').split('.')[0]
		return stub(env, ecid).fetch(request)
	}
	if (
		url.pathname === '/v1/execution-contexts/dispatch' &&
		request.method === 'POST'
	) {
		const { ecid, body } = await request.json()
		return Response.json(await stub(env, ecid).dispatch(body))
	}
	return new Response('origin 404', { status: 404 })
}

export class KodyApi extends WorkerEntrypoint {
	fetch(request) {
		return handle(request, this.env)
	}
}

export default {
	fetch(request, env) {
		return handle(request, env)
	},
}
