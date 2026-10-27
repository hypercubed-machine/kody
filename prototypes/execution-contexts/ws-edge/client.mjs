// ECP prototype 1 client: Node global WebSocket through edge -> origin -> platform DO.
// Usage: node client.mjs [baseUrl] [idleMs]
const base = process.argv[2] ?? 'http://127.0.0.1:8787'
const idleMs = Number(process.argv[3] ?? 20_000)
const wsBase = base.replace(/^http/, 'ws')
const ecid = `ec_proto_${Date.now()}`
const out = {
	node: process.version,
	globalWebSocket: typeof globalThis.WebSocket,
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ticket() {
	const res = await fetch(`${base}/v1/execution-contexts/connect-ticket`, {
		method: 'POST',
		body: JSON.stringify({ ecid }),
	})
	return (await res.json()).ticket
}

function open(url) {
	return new Promise((resolve) => {
		const ws = new WebSocket(url)
		const queue = []
		const waiters = []
		ws.addEventListener('message', (event) => {
			const message = JSON.parse(event.data)
			const index = waiters.findIndex((w) => w.match(message))
			if (index >= 0) waiters.splice(index, 1)[0].resolve(message)
			else queue.push(message)
		})
		ws.next = (match, timeoutMs = 10_000) => {
			const index = queue.findIndex(match)
			if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0])
			return new Promise((res, rej) => {
				waiters.push({ match, resolve: res })
				setTimeout(
					() => rej(new Error('timeout waiting for message')),
					timeoutMs,
				)
			})
		}
		ws.addEventListener('open', async () =>
			resolve({
				ok: true,
				ws,
				welcome: await ws.next((m) => m.t === 'welcome'),
			}),
		)
		ws.addEventListener('error', (event) =>
			resolve({
				ok: false,
				error: String(event.message ?? event.error ?? 'error'),
			}),
		)
		ws.addEventListener(
			'close',
			(event) => (ws.closeInfo = { code: event.code, reason: event.reason }),
		)
	})
}

const byType = (t) => (m) => m.t === t
const ackOf = (re) => (m) => m.t === 'ack' && m.re === re

const genericAttempt = await open(
	`${wsBase}/generic/v1/execution-contexts/connect?ticket=${await ticket()}`,
)
out.genericEdgePath = { opened: genericAttempt.ok, error: genericAttempt.error }
if (genericAttempt.ok) genericAttempt.ws.close()
const rebuiltAttempt = await open(
	`${wsBase}/rebuilt/v1/execution-contexts/connect?ticket=${await ticket()}`,
)
out.rebuiltResponsePath = {
	opened: rebuiltAttempt.ok,
	error: rebuiltAttempt.error,
}
if (rebuiltAttempt.ok) rebuiltAttempt.ws.close()

const firstTicket = await ticket()
const t0 = performance.now()
const conn = await open(
	`${wsBase}/v1/execution-contexts/connect?ticket=${firstTicket}`,
)
out.dedicatedPath = {
	opened: conn.ok,
	error: conn.error,
	welcome: conn.welcome,
	connectMs: Math.round(performance.now() - t0),
}
if (!conn.ok) {
	console.log(JSON.stringify(out, null, 2))
	process.exit(1)
}
const { ws } = conn
ws.send(JSON.stringify({ t: 'heartbeat' }))
out.heartbeatBeforeIdle = await ws.next(ackOf('heartbeat'))
ws.send('{"t":"ping"}')
out.pongBeforeIdle = await ws.next(byType('pong'))

await sleep(idleMs)
ws.send('{"t":"ping"}')
out.pongAfterIdle = await ws.next(byType('pong'))
const dispatch = await (
	await fetch(`${base}/v1/execution-contexts/dispatch`, {
		method: 'POST',
		body: JSON.stringify({ ecid, body: { runId: 'run_1' } }),
	})
).json()
out.dispatchAfterIdle = {
	rpc: dispatch,
	frame: await ws.next(byType('run.request')),
}
out.hibernatedWhileIdle =
	dispatch.instanceId !== out.heartbeatBeforeIdle.instanceId
ws.send(JSON.stringify({ t: 'heartbeat' }))
out.heartbeatAfterIdle = await ws.next(ackOf('heartbeat'))

for (const mib of [6, 33]) {
	try {
		ws.send('x'.repeat(mib * 1024 * 1024))
		const ack = await ws.next(ackOf('big'), 15_000)
		out[`frame${mib}MiB`] = { size: ack.size }
	} catch (error) {
		await sleep(500)
		out[`frame${mib}MiB`] = { error: String(error), closeInfo: ws.closeInfo }
	}
}

const reuse = await open(
	`${wsBase}/v1/execution-contexts/connect?ticket=${firstTicket}`,
)
out.ticketReuse = { opened: reuse.ok, error: reuse.error }
ws.close()
console.log(JSON.stringify(out, null, 2))
process.exit(0)
