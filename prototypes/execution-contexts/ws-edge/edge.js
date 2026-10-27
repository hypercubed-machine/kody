/* oxlint-disable no-undef -- Workers runtime globals; throwaway prototype */
// Mimics packages/api-worker/src/edge.ts: a dedicated upgrade branch plus the
// generic allowlisted-header path and the rebuilt-response path.
const allowedHeaders = ['accept', 'content-type', 'authorization', 'user-agent']

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		const isUpgrade =
			request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
		if (url.pathname === '/v1/execution-contexts/connect' && isUpgrade) {
			return env.KODY_API.fetch(request)
		}
		if (
			url.pathname.startsWith('/generic/') ||
			url.pathname.startsWith('/rebuilt/')
		) {
			const mode = url.pathname.split('/')[1]
			const forwardUrl = new URL(url)
			forwardUrl.pathname = url.pathname.slice(mode.length + 1)
			let headers = request.headers
			if (mode === 'generic') {
				headers = new Headers()
				for (const name of allowedHeaders) {
					const value = request.headers.get(name)
					if (value) headers.set(name, value)
				}
			}
			const response = await env.KODY_API.fetch(
				new Request(forwardUrl, { method: request.method, headers }),
			)
			try {
				return new Response(response.body, {
					status: response.status,
					headers: response.headers,
				})
			} catch (error) {
				return new Response(`rebuild failed: ${error}`, { status: 502 })
			}
		}
		return env.KODY_API.fetch(request)
	},
}
