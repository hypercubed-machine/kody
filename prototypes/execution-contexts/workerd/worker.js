/* oxlint-disable no-undef -- Workers runtime globals; throwaway prototype */
// Prototype worker for ECP draft 2 checks (ed25519, disk services, egress).
import { connect } from 'cloudflare:sockets'

const enc = (s) => new TextEncoder().encode(s)
const b64e = (buf) => {
	let s = ''
	for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const b64d = (s) => {
	const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
	return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function ed25519(request) {
	const { jwk, msg, sig } = await request.json()
	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'Ed25519' },
		false,
		['verify'],
	)
	const ok = await crypto.subtle.verify(
		{ name: 'Ed25519' },
		key,
		b64d(sig),
		enc(msg),
	)
	const tampered = await crypto.subtle.verify(
		{ name: 'Ed25519' },
		key,
		b64d(sig),
		enc(msg + 'x'),
	)
	const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
		'sign',
		'verify',
	])
	const serverJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
	const serverMsg =
		'kody-ecp/1\n' + b64e(enc(JSON.stringify({ v: 1, t: 'run.request' })))
	const serverSig = b64e(
		await crypto.subtle.sign(
			{ name: 'Ed25519' },
			pair.privateKey,
			enc(serverMsg),
		),
	)
	return Response.json({
		ok,
		tampered,
		server: { jwk: serverJwk, msg: serverMsg, sig: serverSig },
	})
}

async function fsCase(binding, method, rawPath, body) {
	try {
		const res = await binding.fetch(
			new Request('http://fs' + rawPath, { method, body }),
		)
		const text = await res.text()
		return {
			method,
			path: rawPath,
			status: res.status,
			body: text.slice(0, 80),
		}
	} catch (error) {
		return { method, path: rawPath, error: String(error).slice(0, 160) }
	}
}

async function fsTest(env, url) {
	const binding = env[url.searchParams.get('binding')]
	const cases = [
		['GET', '/hello.txt'],
		['GET', '/'],
		['GET', '/.secret'],
		['GET', '/.git/config'],
		['GET', '/link-to-dotfile'],
		['GET', '/link-out.txt'],
		['GET', '/link-dir-out/inside-outside.txt'],
		['GET', '/link-abs-out.txt'],
		['GET', '/%2e%2e/outside.txt'],
		['GET', '/sub/..%2f..%2foutside.txt'],
		['GET', '/sub%2f..%2f..%2foutside.txt'],
		['PUT', '/new.txt', 'new'],
		['PUT', '/link-out.txt', 'OVERWRITTEN-THROUGH-SYMLINK'],
		['PUT', '/.dotnew', 'dot'],
		['PUT', '/newdir/nested.txt', 'nested'],
		['DELETE', '/hello.txt'],
	]
	const results = []
	for (const [method, path, body] of cases)
		results.push(await fsCase(binding, method, path, body))
	return Response.json(results)
}

async function tryFetch(target) {
	try {
		const res = await fetch(target)
		return {
			target,
			status: res.status,
			body: (await res.text()).slice(0, 160),
		}
	} catch (error) {
		return { target, error: String(error).slice(0, 200) }
	}
}

async function tryConnect(hostname, port) {
	try {
		const socket = connect({ hostname, port })
		const writer = socket.writable.getWriter()
		await writer.write(enc('ping\n'))
		const reader = socket.readable.getReader()
		const timeout = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('read timeout')), 3000),
		)
		const { value } = await Promise.race([reader.read(), timeout])
		await socket.close().catch(() => {})
		return {
			target: `${hostname}:${port}`,
			read: new TextDecoder().decode(value ?? new Uint8Array()).slice(0, 120),
		}
	} catch (error) {
		return { target: `${hostname}:${port}`, error: String(error).slice(0, 200) }
	}
}

async function egress(url) {
	const echoPort = Number(url.searchParams.get('echoPort'))
	return Response.json({
		fetchHttp: await tryFetch('http://plain.example.test/path?q=1'),
		fetchHttps: await tryFetch('https://secure.example.test/x'),
		fetchLoopback: await tryFetch(`http://127.0.0.1:${echoPort}/direct`),
		connectNamed: await tryConnect('tcp.example.test', 4444),
		connectLoopback: await tryConnect('127.0.0.1', echoPort),
	})
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		try {
			if (url.pathname === '/ed25519') return await ed25519(request)
			if (url.pathname === '/fs') return await fsTest(env, url)
			if (url.pathname === '/egress') return await egress(url)
			return new Response('not found', { status: 404 })
		} catch (error) {
			return Response.json(
				{ error: String(error?.stack ?? error) },
				{ status: 500 },
			)
		}
	},
}
