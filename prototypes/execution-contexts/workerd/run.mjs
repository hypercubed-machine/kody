// Runs ECP prototypes 2, 3 and 4 against the pinned workerd.
// Usage: node run.mjs  (KODY_WORKERD_PATH overrides the binary)
import { spawn } from 'node:child_process'
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	symlinkSync,
	existsSync,
	readdirSync,
	copyFileSync,
	lstatSync,
} from 'node:fs'
import { createServer as createTcpServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workerdVersion = '1.20260815.1'
const workerdPath =
	process.env.KODY_WORKERD_PATH ??
	join(
		homedir(),
		'.cache/kody/workerd',
		`${workerdVersion}-linux-64`,
		'workerd',
	)
const runtimeSource = readFileSync(
	join(here, '../../../packages/cli/src/local-runtime-source.ts'),
	'utf8',
)
const compatDate =
	runtimeSource.match(/localExecuteCompatibilityDate\s*=\s*'([^']+)'/)?.[1] ??
	'2026-08-01'

const listen = (server) =>
	new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
	)
const freePort = async () => {
	const s = createTcpServer()
	const p = await listen(s)
	s.close()
	return p
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeTree(base, label) {
	const root = join(base, label, 'root')
	mkdirSync(join(root, '.git'), { recursive: true })
	mkdirSync(join(root, 'sub'), { recursive: true })
	mkdirSync(join(base, label, 'outsidedir'), { recursive: true })
	writeFileSync(join(root, 'hello.txt'), 'HELLO')
	writeFileSync(join(root, '.secret'), 'DOTFILE')
	writeFileSync(join(root, '.git/config'), 'GITCONFIG')
	writeFileSync(join(base, label, 'outside.txt'), 'OUTSIDE')
	writeFileSync(
		join(base, label, 'outsidedir/inside-outside.txt'),
		'OUTSIDE-DIR',
	)
	symlinkSync('.secret', join(root, 'link-to-dotfile'))
	symlinkSync('../outside.txt', join(root, 'link-out.txt'))
	symlinkSync('../outsidedir', join(root, 'link-dir-out'))
	symlinkSync(join(base, label, 'outside.txt'), join(root, 'link-abs-out.txt'))
	return root
}

function config({ port, outbound, rwRoot, roRoot }) {
	const outboundService = {
		bridgeProxy: `(name = "out", external = (address = "127.0.0.1:${outbound.port}", http = (style = proxy))),`,
		bridgeHost: `(name = "out", external = (address = "127.0.0.1:${outbound.port}", http = ())),`,
		publicNetwork: `(name = "out", network = (allow = ["public"], tlsOptions = (trustBrowserCas = true))),`,
	}[outbound.kind]
	return `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "main", worker = .w),
    ${outboundService}
    (name = "fs-rw", disk = (path = ${JSON.stringify(rwRoot)}, writable = true, allowDotfiles = false)),
    (name = "fs-ro", disk = (path = ${JSON.stringify(roRoot)}, writable = false, allowDotfiles = false)),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:${port}", http = (), service = "main") ],
);
const w :Workerd.Worker = (
  modules = [ (name = "worker.js", esModule = embed "worker.js") ],
  compatibilityDate = "${compatDate}",
  compatibilityFlags = ["nodejs_compat"],
  globalOutbound = "out",
  bindings = [ (name = "FS_RW", service = "fs-rw"), (name = "FS_RO", service = "fs-ro") ],
);
`
}

async function startWorkerd(dir, configText) {
	writeFileSync(join(dir, 'config.capnp'), configText)
	copyFileSync(join(here, 'worker.js'), join(dir, 'worker.js'))
	const child = spawn(workerdPath, ['serve', join(dir, 'config.capnp')], {
		cwd: dir,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let log = ''
	child.stdout.on('data', (d) => (log += d))
	child.stderr.on('data', (d) => (log += d))
	return { child, log: () => log }
}

async function waitFor(url) {
	for (let i = 0; i < 100; i++) {
		try {
			await fetch(url)
			return
		} catch {
			await sleep(100)
		}
	}
	throw new Error('workerd did not start: ' + url)
}

const bridgeLog = []
const bridge = createTcpServer((socket) => {
	let first = true
	let tunnel = false
	socket.on('data', (chunk) => {
		if (tunnel) return void socket.write('bridge-tunnel:' + chunk)
		if (!first) return
		first = false
		const text = chunk.toString('latin1')
		const [requestLine, ...headerLines] = text
			.split('\r\n\r\n')[0]
			.split('\r\n')
		bridgeLog.push({
			requestLine,
			headers: headerLines.filter((h) =>
				/^(host|proxy-|connection|upgrade)/i.test(h),
			),
		})
		if (requestLine.startsWith('CONNECT ')) {
			tunnel = true
			socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
			const rest = chunk.subarray(chunk.indexOf('\r\n\r\n') + 4)
			if (rest.length > 0) socket.write('bridge-tunnel:' + rest)
			return
		}
		const body = `bridge saw ${requestLine}`
		socket.end(
			`HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
		)
	})
})
const bridgePort = await listen(bridge)
const echo = createTcpServer((s) =>
	s.on('data', () =>
		s.end(
			'HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\necho',
		),
	),
)
const echoPort = await listen(echo)

const base = mkdtempSync(join(tmpdir(), 'ecp-proto-'))
const results = {
	node: process.version,
	nodeGlobalWebSocket: typeof globalThis.WebSocket,
	workerd: workerdVersion,
	compatDate,
}

for (const kind of ['bridgeProxy', 'bridgeHost', 'publicNetwork']) {
	const dir = join(base, kind)
	mkdirSync(dir, { recursive: true })
	const rwRoot = makeTree(dir, 'rw')
	const roRoot = makeTree(dir, 'ro')
	const port = await freePort()
	const wd = await startWorkerd(
		dir,
		config({ port, outbound: { kind, port: bridgePort }, rwRoot, roRoot }),
	)
	try {
		await waitFor(`http://127.0.0.1:${port}/`)
		bridgeLog.length = 0
		const egress = await (
			await fetch(`http://127.0.0.1:${port}/egress?echoPort=${echoPort}`)
		).json()
		results[`egress_${kind}`] = { worker: egress, bridgeSaw: [...bridgeLog] }
		if (kind === 'bridgeProxy') {
			results.fs_rw = await (
				await fetch(`http://127.0.0.1:${port}/fs?binding=FS_RW`)
			).json()
			results.fs_ro = await (
				await fetch(`http://127.0.0.1:${port}/fs?binding=FS_RO`)
			).json()
			results.fs_disk_after = {
				rwOutside: readFileSync(join(dir, 'rw/outside.txt'), 'utf8'),
				rwRootEntries: readdirSync(rwRoot).sort(),
				rwHelloExists: existsSync(join(rwRoot, 'hello.txt')),
				rwLinkOutIsSymlink: lstatSync(
					join(rwRoot, 'link-out.txt'),
				).isSymbolicLink(),
				rwLinkOutContent: readFileSync(join(rwRoot, 'link-out.txt'), 'utf8'),
				roOutside: readFileSync(join(dir, 'ro/outside.txt'), 'utf8'),
				roRootEntries: readdirSync(roRoot).sort(),
			}
			const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
				'sign',
				'verify',
			])
			const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
			const nodeExportedAlg = jwk.alg
			delete jwk.alg
			const p = Buffer.from(
				JSON.stringify({ v: 1, t: 'run.result', seq: 1 }),
			).toString('base64url')
			const msg = 'kody-ecp/1\n' + p
			const sig = Buffer.from(
				await crypto.subtle.sign(
					{ name: 'Ed25519' },
					pair.privateKey,
					new TextEncoder().encode(msg),
				),
			).toString('base64url')
			const ed = await (
				await fetch(`http://127.0.0.1:${port}/ed25519`, {
					method: 'POST',
					body: JSON.stringify({ jwk, msg, sig }),
				})
			).json()
			let nodeVerifiesServer = null
			if (ed.server) {
				let serverKey
				try {
					serverKey = await crypto.subtle.importKey(
						'jwk',
						ed.server.jwk,
						{ name: 'Ed25519' },
						false,
						['verify'],
					)
				} catch (error) {
					results.nodeImportWorkerdJwkError = String(error)
					const { alg: _alg, ...rest } = ed.server.jwk
					serverKey = await crypto.subtle.importKey(
						'jwk',
						rest,
						{ name: 'Ed25519' },
						false,
						['verify'],
					)
				}
				results.workerdExportedAlg = ed.server.jwk.alg ?? null
				nodeVerifiesServer = await crypto.subtle.verify(
					{ name: 'Ed25519' },
					serverKey,
					Buffer.from(ed.server.sig, 'base64url'),
					new TextEncoder().encode(ed.server.msg),
				)
			}
			const t0 = performance.now()
			for (let i = 0; i < 1000; i++)
				await crypto.subtle.verify(
					{ name: 'Ed25519' },
					pair.publicKey,
					Buffer.from(sig, 'base64url'),
					new TextEncoder().encode(msg),
				)
			results.ed25519 = {
				nodeExportedAlg,
				workerdVerifiesNode: ed.ok,
				workerdRejectsTampered: ed.tampered === false,
				nodeVerifiesServer,
				error: ed.error,
				nodeVerifyMsPer1000: Math.round(performance.now() - t0),
			}
		}
	} finally {
		wd.child.kill('SIGKILL')
		results[`workerdLog_${kind}`] = wd.log().slice(0, 1500)
	}
}
bridge.close()
echo.close()
console.log(JSON.stringify(results, null, 2))
