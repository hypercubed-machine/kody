/* oxlint-disable no-undef -- Workers runtime globals; throwaway prototype */
import { DurableObject } from 'cloudflare:workers'

export class ExecutionContextSessionV1 extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env)
		this.instanceId = crypto.randomUUID().slice(0, 8)
		ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'),
		)
	}

	async issueTicket(ticket) {
		await this.ctx.storage.put(`ticket:${ticket}`, Date.now() + 30_000)
		return { instanceId: this.instanceId }
	}

	async fetch(request) {
		const ticket = new URL(request.url).searchParams.get('ticket') ?? ''
		const expiresAt = await this.ctx.storage.get(`ticket:${ticket}`)
		if (!expiresAt || expiresAt < Date.now())
			return new Response('bad ticket', { status: 401 })
		await this.ctx.storage.delete(`ticket:${ticket}`)
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('expected websocket upgrade', { status: 426 })
		}
		const [client, server] = Object.values(new WebSocketPair())
		const sid = `ses_${crypto.randomUUID().slice(0, 8)}`
		this.ctx.acceptWebSocket(server)
		server.serializeAttachment({ sid, inSeq: 0 })
		server.send(
			JSON.stringify({ t: 'welcome', sid, instanceId: this.instanceId }),
		)
		return new Response(null, { status: 101, webSocket: client })
	}

	async webSocketMessage(ws, message) {
		const attachment = ws.deserializeAttachment()
		attachment.inSeq += 1
		ws.serializeAttachment(attachment)
		const size =
			typeof message === 'string' ? message.length : message.byteLength
		let type = 'big'
		if (size < 100_000) type = JSON.parse(message).t
		const autoResponseAt = this.ctx.getWebSocketAutoResponseTimestamp(ws)
		ws.send(
			JSON.stringify({
				t: 'ack',
				re: type,
				size,
				inSeq: attachment.inSeq,
				sid: attachment.sid,
				instanceId: this.instanceId,
				autoResponseAt: autoResponseAt ? autoResponseAt.getTime() : null,
			}),
		)
	}

	async webSocketClose(ws, code, reason) {
		// 1005 and 1006 are reserved and throw if echoed back.
		if (code === 1005 || code === 1006) return
		ws.close(code, reason)
	}

	async dispatch(body) {
		const sockets = this.ctx.getWebSockets()
		for (const ws of sockets) {
			ws.send(
				JSON.stringify({
					t: 'run.request',
					body,
					instanceId: this.instanceId,
					attachment: ws.deserializeAttachment(),
				}),
			)
		}
		return { sockets: sockets.length, instanceId: this.instanceId }
	}
}

export default {
	fetch() {
		return new Response('platform')
	},
}
