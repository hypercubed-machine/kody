import { expect, test } from 'vitest'
import { buildPackageAppCustomHostnameSetup } from './setup-instructions.ts'

test('setup lists the CNAME plus TXT records, all DNS only, with relative names', () => {
	const setup = buildPackageAppCustomHostnameSetup({
		hostname: 'apps.example.co.uk',
		cnameTarget: 'domains.kody.run',
		ownershipVerification: {
			type: 'txt',
			name: '_cf-custom-hostname.apps.example.co.uk',
			value: 'owner',
		},
		sslValidationRecords: [
			{ type: 'txt', name: '_acme-challenge.apps.example.co.uk', value: 'a' },
			{ type: 'txt', name: '_acme-challenge.apps.example.co.uk', value: 'a' },
			{
				type: 'http',
				name: 'http://apps.example.co.uk/.well-known/x',
				value: 'b',
			},
		],
	})
	expect(
		setup.records.map((record) => [
			record.type,
			record.relative_name,
			record.value,
			record.proxy,
		]),
	).toEqual([
		['CNAME', 'apps', 'domains.kody.run', 'dns_only'],
		['TXT', '_cf-custom-hostname.apps', 'owner', 'dns_only'],
		['TXT', '_acme-challenge.apps', 'a', 'dns_only'],
	])
	expect(setup.steps[1]).toMatch(/3 records/)
	expect(setup.provider_notes.join('\n')).toMatch(/grey cloud/)
})

test('a root hostname uses @ and a missing CNAME target still explains the record', () => {
	const setup = buildPackageAppCustomHostnameSetup({
		hostname: 'example.com',
		cnameTarget: null,
		ownershipVerification: null,
		sslValidationRecords: [],
	})
	expect(setup.records).toEqual([])
	expect(setup.steps[1]).toMatch(/Add a CNAME/)
	const withTarget = buildPackageAppCustomHostnameSetup({
		hostname: 'example.com',
		cnameTarget: 'domains.kody.run',
		ownershipVerification: null,
		sslValidationRecords: [],
	})
	expect(withTarget.records[0]?.relative_name).toBe('@')
})
