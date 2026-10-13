import { expect, test, waitForClientHydration } from './playwright-utils.ts'

test('Credentials lists a key, filters by kind, and opens its detail pane without the value', async ({
	page,
	seedE2eUser,
	login,
}) => {
	test.setTimeout(process.env.CI ? 90_000 : 60_000)
	const runId = Date.now()
	const user = await seedE2eUser({
		email: `credentials-${runId}@example.com`,
		username: `credentials-${runId}`,
		password: 'credentials-password',
	})
	await login({ email: user.email, password: user.password, mode: 'login' })
	const value = `sk-never-shown-${runId}`
	const saved = await page.request.post('/account/secrets.json', {
		data: {
			action: 'save',
			name: 'DEMO_API_KEY',
			scope: 'user',
			value,
			description: 'Demo key',
			allowedHosts: ['api.example.com'],
			allowedPackages: [],
		},
		headers: { 'Content-Type': 'application/json' },
	})
	expect(saved.ok()).toBe(true)

	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto(`/@${user.username}/-/credentials`)
	await waitForClientHydration(page)
	const table = page.getByRole('region', { name: 'Credentials', exact: true })
	const row = table.getByRole('link', { name: /DEMO_API_KEY/ })
	await expect(row).toBeVisible()

	await page
		.getByRole('combobox', { name: 'Filter credentials by kind' })
		.selectOption('oauth')
	await expect(page).toHaveURL(/\/credentials\?kind=oauth$/)
	await expect(row).toHaveCount(0)
	await page
		.getByRole('combobox', { name: 'Filter credentials by kind' })
		.selectOption('secret')
	await expect(row).toBeVisible()

	await row.click()
	await expect(page).toHaveURL(
		new RegExp(`/@${user.username}/-/credentials/[^/?]+\\?kind=secret$`),
	)
	const pane = page.getByRole('region', { name: 'DEMO_API_KEY details' })
	await expect(pane.getByText('{{secret:DEMO_API_KEY}}')).toBeVisible()
	await expect(pane.getByText('api.example.com')).toBeVisible()
	await expect(pane.getByText('Authorization: Bearer {value}')).toBeVisible()
	await expect(pane.getByRole('link', { name: 'Edit' })).toHaveAttribute(
		'href',
		`/@${user.username}/-/secrets/user/DEMO_API_KEY`,
	)
	await expect(page.getByText(value)).toHaveCount(0)

	// The open row collapses back to the list, keeping the filter.
	await row.click()
	await expect(page).toHaveURL(
		new RegExp(`/@${user.username}/-/credentials\\?kind=secret$`),
	)
	await expect(pane).toHaveCount(0)

	// The pages Credentials folds together keep serving.
	for (const section of [
		'secrets',
		'integrations',
		'mcp-servers',
		'secret-providers',
	]) {
		const response = await page.goto(`/@${user.username}/-/${section}`)
		expect(response?.status(), section).toBe(200)
	}
})

test('the creation link saves Key, URL, and login credentials from their prefill', async ({
	page,
	seedE2eUser,
	login,
}) => {
	test.setTimeout(process.env.CI ? 90_000 : 60_000)
	const runId = Date.now()
	const user = await seedE2eUser({
		email: `credential-link-${runId}@example.com`,
		username: `credential-link-${runId}`,
		password: 'credential-link-password',
	})
	await login({ email: user.email, password: user.password, mode: 'login' })
	const value = `re-never-shown-${runId}`

	await page.goto(
		'/connect/credential?kind=secret&kindMode=required&name=DIGEST_KEY&provider=resend&allowedHosts=api.resend.com&forPackage=pr-digest&need=email',
	)
	await waitForClientHydration(page)
	await expect(page.getByRole('heading', { name: 'Add a key' })).toBeVisible()
	await expect(
		page.getByText('This link asks for a Key credential.'),
	).toBeVisible()
	await expect(page.getByTestId('credential-kind-oauth')).toHaveCount(0)
	await expect(page.getByLabel('Name')).toHaveValue('DIGEST_KEY')
	await expect(page.getByLabel(/Allowed hosts/)).toHaveValue('api.resend.com')
	await page.getByRole('textbox', { name: 'Value' }).fill(value)
	await page.getByTestId('connect-credential-save').click()
	await expect(page.getByTestId('connect-credential-saved')).toContainText(
		'DIGEST_KEY is saved',
	)
	await expect(page.getByText(value)).toHaveCount(0)

	await page.getByRole('link', { name: 'View credential' }).click()
	const pane = page.getByRole('region', { name: 'DIGEST_KEY details' })
	await expect(pane.getByText('api.resend.com')).toBeVisible()
	await expect(pane.getByText('resend', { exact: true })).toBeVisible()

	// A hinted kind can change; OAuth hands the prefill to /connect/oauth.
	await page.goto('/connect/credential?kind=secret&provider=github')
	await waitForClientHydration(page)
	await page.getByTestId('credential-kind-oauth').click()
	await expect(page).toHaveURL(
		new RegExp(
			`/@${user.username}/-/credentials/new\\?kind=oauth&provider=github$`,
		),
	)
	await expect(page.getByTestId('connect-credential-continue')).toHaveAttribute(
		'href',
		'/connect/oauth?kind=oauth&provider=github',
	)

	// A URL credential takes its hosts; a value off those hosts is refused
	// with a prompt the person can hand their agent.
	await page.goto(
		'/connect/credential?kind=url&kindMode=required&name=BOT_URL&allowedHosts=api.telegram.org',
	)
	await waitForClientHydration(page)
	await expect(
		page.getByRole('heading', { name: 'Add a URL credential' }),
	).toBeVisible()
	await expect(page.getByLabel(/^Hosts/)).toHaveValue('api.telegram.org')
	const urlValue = `https://api.telegram.org/bot${runId}:never-shown/sendMessage`
	await page
		.getByRole('textbox', { name: 'Value' })
		.fill('https://hooks.example.com/elsewhere')
	await page.getByTestId('connect-credential-save').click()
	await expect(page.getByTestId('connect-credential-message')).toContainText(
		'must be one of its hosts',
	)
	await expect(
		page.getByRole('button', { name: 'Copy prompt for your agent' }),
	).toBeVisible()
	await page.getByRole('textbox', { name: 'Value' }).fill(urlValue)
	await page.getByTestId('connect-credential-save').click()
	await expect(page.getByTestId('connect-credential-saved')).toContainText(
		'BOT_URL is saved',
	)
	await page.getByRole('link', { name: 'View credential' }).click()
	const urlPane = page.getByRole('region', { name: 'BOT_URL details' })
	await expect(urlPane.getByText('api.telegram.org')).toBeVisible()
	await expect(page.getByText(urlValue)).toHaveCount(0)

	// A login link carries its exchange, so the person types only the fields
	// the exchange body names.
	const exchange = {
		url: 'https://api.example.com/session',
		bodyFormat: 'json',
		body: { email: '{email}', password: '{password}' },
		tokenPath: 'data.token',
	}
	await page.goto(
		`/connect/credential?kind=login&name=SITE_LOGIN&allowedHosts=api.example.com&loginExchange=${encodeURIComponent(JSON.stringify(exchange))}`,
	)
	await waitForClientHydration(page)
	await expect(
		page.getByTestId('connect-credential-login-exchange'),
	).toContainText('api.example.com')
	await page.getByLabel('Email').fill('me@example.com')
	await page.getByRole('textbox', { name: 'Password' }).fill(`pw-${runId}`)
	await page.getByTestId('connect-credential-save').click()
	await expect(page.getByTestId('connect-credential-saved')).toContainText(
		'SITE_LOGIN is saved',
	)
})
