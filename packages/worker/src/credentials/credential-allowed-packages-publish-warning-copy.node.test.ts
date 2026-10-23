import { expect, test } from 'vitest'
import { formatCredentialAllowedPackagesPublishWarning } from './credential-allowed-packages-publish-warning.ts'

test('warning copy describes current behavior without a rollout date', () => {
	const message = formatCredentialAllowedPackagesPublishWarning({
		credentialName: 'RESEND_API_KEY',
		allowedEntries: [
			{ kind: 'package', id: 'pkg-notes', displayName: '@owner/notes' },
		],
		packageDisplayName: '@owner/demo',
		approvalUrl:
			'https://kody.codes/@owner/-/secrets/user/RESEND_API_KEY?package_id=pkg-demo&package=demo',
	})
	expect(message).toContain(
		'Credential "RESEND_API_KEY" is allowed only for @owner/notes, not @owner/demo.',
	)
	expect(message).toContain(
		'Kody denies this use when @owner/demo is used through another package',
	)
	expect(message).toContain('still allows it for now')
	expect(message).toContain(
		'approve: https://kody.codes/@owner/-/secrets/user/RESEND_API_KEY?package_id=pkg-demo&package=demo.',
	)
	expect(message).not.toMatch(/Starting|2026|Wednesday/)
})
