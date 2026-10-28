import { env, runInDurableObject } from 'cloudflare:test'
import { expect, test } from 'vitest'
import {
	ExecutionContextSessionV1,
	executionContextsUnavailableCode,
} from './session-do.ts'

test('the execution context session refuses every request and stores nothing', async () => {
	const stub = env.EXECUTION_CONTEXT_SESSION.get(
		env.EXECUTION_CONTEXT_SESSION.idFromName('ec_test_1'),
	)
	for (const init of [
		{ headers: { Upgrade: 'websocket' } },
		{ method: 'POST', body: '{}' },
		{},
	] satisfies Array<RequestInit>) {
		const response = await stub.fetch('https://session.test/connect', init)
		expect(response.status).toBe(503)
		expect(response.webSocket).toBeNull()
		expect(await response.json()).toMatchObject({
			ok: false,
			error: { code: executionContextsUnavailableCode },
		})
	}
	await runInDurableObject(stub, async (instance, state) => {
		expect(instance).toBeInstanceOf(ExecutionContextSessionV1)
		expect((await state.storage.list()).size).toBe(0)
		expect(await state.storage.getAlarm()).toBeNull()
		const tables = state.storage.sql
			.exec(
				`SELECT name FROM sqlite_master
				WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`,
			)
			.toArray()
		expect(tables).toEqual([])
	})
})
