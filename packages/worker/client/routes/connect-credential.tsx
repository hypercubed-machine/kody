import { type Handle, type RemixNode, css } from 'remix/component'
import { readCurrentRouterHref } from '#client/client-router.tsx'
import { CopyTextButton } from '#client/copy-text-button.tsx'
import { on } from '#client/event-mixin.ts'
import { tryConsumeRouteLoaderData } from '#client/loader-data-context.tsx'
import { passwordManagerIgnoreProps } from '#client/password-manager-ignore.ts'
import { PasswordRevealInput } from '#client/password-reveal-input.tsx'
import {
	type RouteLoaderResult,
	routeLoaderRedirect,
} from '#client/route-loader.ts'
import {
	accountSecretsApiPath,
	readJson,
} from '#client/routes/account-approval-shared.ts'
import {
	buildKeySaveBody,
	createKeyFormState,
	credentialCreateAgentPrompt,
	credentialCreateHandoffHref,
	credentialCreateKindSummary,
	credentialCreateMode,
	credentialCreateTitle,
	findExistingOrgKey,
	findMatchingCredentials,
	isMaskedLoginField,
	isValueFormKind,
	type KeyFormState,
	loginFieldNames,
	type ValueFormKind,
	writeCredentialCreateKind,
} from '#client/routes/connect-credential-shared.ts'
import {
	type CredentialKind,
	type CredentialListItem,
	credentialKinds,
	parseCredentialCreateQuery,
} from '#universal/credential-contracts.ts'
import {
	type AccountCredentialsResponse,
	credentialKindLabel,
} from '#universal/credentials-list.ts'
import { orgResourcePath } from '#universal/org-pages.ts'
import { routes } from '#universal/routes.ts'
import {
	cardCss,
	fieldCss,
	fieldLabelCss,
	getPrimaryButtonCss,
	getSecondaryButtonCss,
	inputCss,
	pageDescriptionCss,
	pageEyebrowCss,
	pageHeaderCss,
	pageTitleCss,
	stackedPageCss,
} from '#universal/styles/style-primitives.ts'
import {
	colors,
	radius,
	spacing,
	typography,
} from '#universal/styles/tokens.ts'

const accountCredentialsApiPath = routes.accountCredentialsApi.href()

const primaryButtonCss = getPrimaryButtonCss({ size: 'lg', weight: 'semibold' })
const secondaryButtonCss = getSecondaryButtonCss({
	size: 'lg',
	weight: 'semibold',
})

const kindGridCss = {
	display: 'grid',
	gap: spacing.sm,
	gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
	margin: 0,
	padding: 0,
	border: 'none',
}

const kindOptionCss = {
	display: 'grid',
	gap: spacing.xs,
	padding: spacing.md,
	borderRadius: radius.md,
	border: `1px solid ${colors.border}`,
	color: colors.text,
	textDecoration: 'none',
	'&:hover': { borderColor: colors.primary },
}

const kindOptionSelectedCss = {
	...kindOptionCss,
	borderColor: colors.primary,
	boxShadow: `inset 0 0 0 1px ${colors.primary}`,
}

const mutedCss = { margin: 0, color: colors.textMuted }
const errorCss = { margin: 0, color: colors.danger }
const labelHintCss = {
	fontWeight: typography.fontWeight.normal,
	color: colors.textMuted,
}

export async function connectCredentialRouteLoader(
	url: URL,
	signal: AbortSignal,
): Promise<RouteLoaderResult> {
	const response = await fetch(accountCredentialsApiPath, {
		headers: { Accept: 'application/json' },
		credentials: 'include',
		signal,
	})
	if (response.status === 401) {
		return routeLoaderRedirect(
			`/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
		)
	}
	const payload = await readJson<AccountCredentialsResponse>(response)
	if (!response.ok || !payload?.ok) {
		throw new Error('Unable to load your credentials.')
	}
	return { accountCredentials: payload }
}

function renderKindOption(input: {
	kind: CredentialKind
	selected: boolean
	href: string
}) {
	return (
		<li key={input.kind} mix={css({ listStyle: 'none' })}>
			<a
				href={input.href}
				aria-current={input.selected ? 'true' : undefined}
				data-testid={`credential-kind-${input.kind}`}
				mix={css(input.selected ? kindOptionSelectedCss : kindOptionCss)}
			>
				<strong>{credentialKindLabel(input.kind)}</strong>
				<span mix={css({ color: colors.textMuted })}>
					{credentialCreateKindSummary(input.kind)}
				</span>
			</a>
		</li>
	)
}

function valuePlaceholder(kind: ValueFormKind) {
	switch (kind) {
		case 'secret':
			return 'Paste the value'
		case 'url':
			return 'https://hooks.example.com/…'
		case 'signing':
			return 'Paste the signing secret or private key'
		case 'login':
			return ''
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

function hostsHint(kind: ValueFormKind) {
	switch (kind) {
		case 'secret':
			return 'Kody fills the value only on HTTPS requests to these hosts.'
		case 'url':
			return 'Kody sends this URL only to these hosts. Its own host must be one of them.'
		case 'login':
			return 'Kody logs in and sends the session token only to these hosts. The exchange URL must be on one of them.'
		case 'signing':
			return 'Kody signs only for requests to these hosts.'
		default: {
			const exhaustive: never = kind
			return exhaustive
		}
	}
}

function renderMatches(input: {
	matches: ReadonlyArray<CredentialListItem>
	orgSlug: string
}) {
	if (input.matches.length === 0) return null
	return (
		<section mix={css(cardCss)} data-testid="connect-credential-matches">
			<p mix={css({ margin: 0 })}>
				You already have{' '}
				{input.matches.length === 1
					? 'a credential'
					: `${input.matches.length} credentials`}{' '}
				from this provider. If one fits, you do not need a new one.
			</p>
			<ul mix={css({ margin: 0, paddingLeft: spacing.lg })}>
				{input.matches.map((credential) => (
					<li key={credential.id}>
						<a
							href={orgResourcePath(
								input.orgSlug,
								'credentials',
								encodeURIComponent(credential.id),
							)}
						>
							{credential.name}
						</a>{' '}
						<span mix={css({ color: colors.textMuted })}>
							({credentialKindLabel(credential.kind)})
						</span>
					</li>
				))}
			</ul>
		</section>
	)
}

/**
 * `/connect/credential`: the creation link agents hand out. One page picks
 * the kind (fixed when the link requires it), saves a Key, URL, login, or
 * signing credential in place, and hands OAuth and MCP to their own flows with
 * the link's prefill.
 */
export function ConnectCredentialRoute(handle: Handle) {
	let data: AccountCredentialsResponse | null = null
	let form: KeyFormState | null = null
	let formForHref = ''
	let showValue = false
	let saving = false
	let savedName: string | null = null
	let message: string | null = null

	function resetFor(href: string) {
		const query = parseCredentialCreateQuery(
			new URL(href, 'http://localhost').searchParams,
		)
		form = createKeyFormState(query)
		formForHref = href
		savedName = null
		message = null
		showValue = false
	}

	async function refreshCredentials() {
		const response = await fetch(accountCredentialsApiPath, {
			headers: { Accept: 'application/json' },
			credentials: 'include',
		})
		const payload = await readJson<AccountCredentialsResponse>(response)
		if (response.ok && payload?.ok) data = payload
	}

	async function saveKey(event: SubmitEvent, kind: ValueFormKind) {
		event.preventDefault()
		if (saving || !form) return
		const current = form
		const existing = findExistingOrgKey(data?.credentials ?? [], current.name)
		if (existing && !current.replaceExisting) {
			message = `A credential named ${current.name.trim()} already exists. Choose “Replace it” or pick another name.`
			handle.update()
			return
		}
		const save = buildKeySaveBody({ kind, form: current, existing })
		if (!save.ok) {
			message = save.error
			handle.update()
			return
		}
		saving = true
		message = null
		handle.update()
		try {
			const response = await fetch(accountSecretsApiPath, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				credentials: 'include',
				body: JSON.stringify(save.body),
			})
			if (response.status === 401) {
				window.location.assign(
					`/login?redirectTo=${encodeURIComponent(readCurrentRouterHref(handle))}`,
				)
				return
			}
			const payload = await readJson<{ ok?: boolean; error?: string }>(response)
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.error || 'Unable to save this credential.')
			}
			savedName = current.name.trim()
			form = { ...current, value: '', loginFields: {} }
			await refreshCredentials()
		} catch (error) {
			message = error instanceof Error ? error.message : 'Unable to save.'
		} finally {
			saving = false
			handle.update()
		}
	}

	function renderKeyForm(input: {
		kind: ValueFormKind
		state: KeyFormState
		existing: CredentialListItem | null
		orgSlug: string
		prompt: (error: string) => string
	}) {
		const { kind, state, existing } = input
		const isKey = kind === 'secret'
		const update = (patch: Partial<KeyFormState>) => {
			form = { ...state, ...patch }
			handle.update()
		}
		if (savedName) {
			const saved = findExistingOrgKey(data?.credentials ?? [], savedName)
			return (
				<section mix={css(cardCss)} data-testid="connect-credential-saved">
					<p mix={css({ margin: 0 })}>
						<strong>{savedName}</strong> is saved. Return to your agent and
						continue.
					</p>
					{saved ? (
						<a
							href={orgResourcePath(
								input.orgSlug,
								'credentials',
								encodeURIComponent(saved.id),
							)}
							mix={css(secondaryButtonCss)}
						>
							View credential
						</a>
					) : null}
				</section>
			)
		}
		return (
			<section mix={css(cardCss)} data-testid="connect-credential-key-form">
				<form
					{...passwordManagerIgnoreProps}
					mix={[
						css({ display: 'grid', gap: spacing.md }),
						on('submit', (event) => {
							void saveKey(event, kind)
						}),
					]}
				>
					<div mix={css(fieldCss)}>
						<label for="connect-credential-name" mix={css(fieldLabelCss)}>
							Name
						</label>
						<input
							id="connect-credential-name"
							required
							pattern="[a-zA-Z0-9._\-]+"
							value={state.name}
							placeholder="OPENAI_API_KEY"
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({
										name: event.currentTarget.value,
										replaceExisting: false,
									}),
								),
							]}
						/>
						<span mix={css(mutedCss)}>
							{isKey ? (
								<>
									Code refers to it as{' '}
									<code>{`{{secret:${state.name || 'NAME'}}}`}</code>.
								</>
							) : (
								'Packages ask Kody to use it by name. They never see the value.'
							)}
						</span>
					</div>
					{existing ? (
						<label
							mix={css({
								display: 'flex',
								gap: spacing.sm,
								alignItems: 'center',
							})}
						>
							<input
								type="checkbox"
								checked={state.replaceExisting}
								data-testid="connect-credential-replace"
								mix={on('change', (event) =>
									update({ replaceExisting: event.currentTarget.checked }),
								)}
							/>
							<span>
								{isKey ? (
									<>
										A credential named <code>{existing.name}</code> already
										exists. Replace it (its hosts and package locks stay).
									</>
								) : (
									<>
										A credential named <code>{existing.name}</code> already
										exists. Replace it (its package locks stay; its hosts become
										the ones below).
									</>
								)}
							</span>
						</label>
					) : null}
					{kind === 'login' ? (
						renderLoginFields({ state, update })
					) : (
						<div mix={css(fieldCss)}>
							<label for="connect-credential-value" mix={css(fieldLabelCss)}>
								Value
							</label>
							<PasswordRevealInput
								id="connect-credential-value"
								required
								autoFocus={Boolean(state.name)}
								{...passwordManagerIgnoreProps}
								value={state.value}
								placeholder={valuePlaceholder(kind)}
								revealNoun="value"
								revealed={showValue}
								onRevealedChange={(next) => {
									showValue = next
									handle.update()
								}}
								mix={[
									css(inputCss),
									on('input', (event) =>
										update({ value: event.currentTarget.value }),
									),
								]}
							/>
							<span mix={css(mutedCss)}>
								Only Kody sees the value. Agents and package code never do.
							</span>
						</div>
					)}
					<div mix={css(fieldCss)}>
						<label for="connect-credential-hosts" mix={css(fieldLabelCss)}>
							{isKey ? 'Allowed hosts' : 'Hosts'}{' '}
							<span mix={css(labelHintCss)}>(one per line)</span>
						</label>
						<textarea
							id="connect-credential-hosts"
							rows={2}
							required={!isKey}
							value={state.hosts}
							placeholder={
								isKey ? 'api.example.com' : 'api.example.com or *.example.com'
							}
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({ hosts: event.currentTarget.value }),
								),
							]}
						/>
						<span mix={css(mutedCss)}>{hostsHint(kind)}</span>
					</div>
					{kind === 'login' ? renderLoginExchange({ state, update }) : null}
					<div mix={css(fieldCss)}>
						<label for="connect-credential-provider" mix={css(fieldLabelCss)}>
							Provider <span mix={css(labelHintCss)}>(optional)</span>
						</label>
						<input
							id="connect-credential-provider"
							value={state.provider}
							placeholder="openai"
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({ provider: event.currentTarget.value }),
								),
							]}
						/>
					</div>
					<div mix={css(fieldCss)}>
						<label
							for="connect-credential-description"
							mix={css(fieldLabelCss)}
						>
							Description <span mix={css(labelHintCss)}>(optional)</span>
						</label>
						<input
							id="connect-credential-description"
							value={state.description}
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({ description: event.currentTarget.value }),
								),
							]}
						/>
					</div>
					<div mix={css(fieldCss)}>
						<label for="connect-credential-expires" mix={css(fieldLabelCss)}>
							Expires <span mix={css(labelHintCss)}>(optional)</span>
						</label>
						<input
							id="connect-credential-expires"
							type="date"
							value={state.expiresAt}
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({ expiresAt: event.currentTarget.value }),
								),
							]}
						/>
					</div>
					{message ? (
						<div
							role="alert"
							mix={css({
								display: 'grid',
								gap: spacing.sm,
								justifyItems: 'start',
							})}
						>
							<p mix={css(errorCss)} data-testid="connect-credential-message">
								{message}
							</p>
							<CopyTextButton
								value={input.prompt(message)}
								idleLabel="Copy prompt for your agent"
							/>
						</div>
					) : null}
					<button
						type="submit"
						disabled={saving}
						data-testid="connect-credential-save"
						mix={css(primaryButtonCss)}
					>
						{saving ? 'Saving…' : isKey ? 'Save key' : 'Save credential'}
					</button>
				</form>
			</section>
		)
	}

	return () => {
		const href = readCurrentRouterHref(handle)
		const routeData = tryConsumeRouteLoaderData(
			handle,
			'accountCredentials',
			href,
		)
		if (routeData) data = routeData
		if (!form || formForHref !== href) resetFor(href)
		const state = form as KeyFormState
		const search = new URL(href, 'http://localhost').searchParams
		const query = parseCredentialCreateQuery(search)
		const orgSlug = data?.orgSlug ?? ''
		const selected = query.kind
		const kinds = query.kindLocked && selected ? [selected] : credentialKinds
		const matches = data ? findMatchingCredentials(data.credentials, query) : []
		const existing = findExistingOrgKey(data?.credentials ?? [], state.name)
		const pageUrl =
			typeof window === 'undefined'
				? href
				: new URL(href, window.location.origin).toString()

		return (
			<section mix={css(stackedPageCss)} data-testid="connect-credential">
				<header mix={css(pageHeaderCss)}>
					<span mix={css(pageEyebrowCss)}>Add a credential</span>
					<h1 mix={css(pageTitleCss)}>
						{selected ? credentialCreateTitle(selected) : 'Add a credential'}
					</h1>
					<p mix={css(pageDescriptionCss)}>
						{query.packageKodyId && query.needKey ? (
							<>
								For <code>{query.packageKodyId}</code>, which needs{' '}
								<code>{query.needKey}</code>.{' '}
							</>
						) : null}
						Kody keeps the value and places it on requests for you. It never
						appears to agents or package code.
					</p>
				</header>

				{renderMatches({ matches, orgSlug })}

				<section
					aria-label="Credential kind"
					mix={css({ display: 'grid', gap: spacing.sm })}
				>
					{query.kindLocked && selected ? (
						<p mix={css(mutedCss)}>
							This link asks for a {credentialKindLabel(selected)} credential.
						</p>
					) : (
						<p mix={css(mutedCss)}>
							{selected
								? 'Suggested by the link. Pick another kind if it fits better.'
								: 'What kind of credential is it?'}
						</p>
					)}
					<ul mix={css(kindGridCss)}>
						{kinds.map((kind) =>
							renderKindOption({
								kind,
								selected: kind === selected,
								href: writeCredentialCreateKind(href, kind),
							}),
						)}
					</ul>
				</section>

				{selected === null
					? null
					: renderKindBody({
							kind: selected,
							search,
							orgSlug,
							valueForm: (kind) =>
								renderKeyForm({
									kind,
									state,
									existing,
									orgSlug,
									prompt: (error) =>
										credentialCreateAgentPrompt({
											kind,
											query,
											pageUrl,
											error,
										}),
								}),
						})}
			</section>
		)
	}
}

function renderLoginFields(input: {
	state: KeyFormState
	update: (patch: Partial<KeyFormState>) => void
}) {
	const { state, update } = input
	return (
		<fieldset
			mix={css({
				display: 'grid',
				gap: spacing.sm,
				border: 'none',
				margin: 0,
				padding: 0,
			})}
		>
			<legend mix={css({ ...fieldLabelCss, padding: 0 })}>Login</legend>
			{loginFieldNames(state.loginExchange).map((field, index) => {
				const id = `connect-credential-login-${field}`
				const setField = (value: string) =>
					update({ loginFields: { ...state.loginFields, [field]: value } })
				return (
					<div key={field} mix={css(fieldCss)}>
						<label for={id} mix={css(fieldLabelCss)}>
							{field.charAt(0).toUpperCase() + field.slice(1)}
						</label>
						{isMaskedLoginField(field) ? (
							<PasswordRevealInput
								id={id}
								required
								{...passwordManagerIgnoreProps}
								value={state.loginFields[field] ?? ''}
								revealNoun={field}
								mix={[
									css(inputCss),
									on('input', (event) => setField(event.currentTarget.value)),
								]}
							/>
						) : (
							<input
								id={id}
								required
								autoFocus={index === 0 && Boolean(state.name)}
								{...passwordManagerIgnoreProps}
								value={state.loginFields[field] ?? ''}
								mix={[
									css(inputCss),
									on('input', (event) => setField(event.currentTarget.value)),
								]}
							/>
						)}
					</div>
				)
			})}
			<span mix={css(mutedCss)}>
				Only Kody sees these. Agents and package code get a session token, never
				your login.
			</span>
		</fieldset>
	)
}

function renderLoginExchange(input: {
	state: KeyFormState
	update: (patch: Partial<KeyFormState>) => void
}) {
	const { state, update } = input
	const exchange = state.loginExchange
	const setExchange = (patch: Partial<KeyFormState['loginExchange']>) =>
		update({ loginExchange: { ...exchange, ...patch } })
	let exchangeHost: string | null = null
	try {
		exchangeHost = exchange.url ? new URL(exchange.url).host : null
	} catch {
		exchangeHost = null
	}
	return (
		<details
			open={!exchangeHost || !exchange.tokenPath}
			data-testid="connect-credential-login-exchange"
			mix={css({ display: 'grid', gap: spacing.sm })}
		>
			<summary mix={css({ cursor: 'pointer' })}>
				{exchangeHost && exchange.tokenPath ? (
					<>
						Kody sends your login to <code>{exchangeHost}</code> and reads the
						session token from <code>{exchange.tokenPath}</code>.
					</>
				) : (
					'How Kody logs in'
				)}
			</summary>
			<div
				mix={css({ display: 'grid', gap: spacing.md, paddingTop: spacing.sm })}
			>
				<div mix={css(fieldCss)}>
					<label for="connect-credential-exchange-url" mix={css(fieldLabelCss)}>
						Login URL
					</label>
					<input
						id="connect-credential-exchange-url"
						type="url"
						required
						value={exchange.url}
						placeholder="https://api.example.com/login"
						mix={[
							css(inputCss),
							on('input', (event) =>
								setExchange({ url: event.currentTarget.value }),
							),
						]}
					/>
				</div>
				<div mix={css(fieldCss)}>
					<label
						for="connect-credential-exchange-format"
						mix={css(fieldLabelCss)}
					>
						Sent as
					</label>
					<select
						id="connect-credential-exchange-format"
						value={exchange.bodyFormat}
						mix={[
							css(inputCss),
							on('change', (event) =>
								setExchange({
									bodyFormat:
										event.currentTarget.value === 'form' ? 'form' : 'json',
								}),
							),
						]}
					>
						<option value="json">JSON</option>
						<option value="form">Form fields</option>
					</select>
				</div>
				<div mix={css(fieldCss)}>
					<label
						for="connect-credential-exchange-body"
						mix={css(fieldLabelCss)}
					>
						Request body{' '}
						<span mix={css(labelHintCss)}>
							(JSON; <code>{'{username}'}</code> is replaced by that login
							field)
						</span>
					</label>
					<textarea
						id="connect-credential-exchange-body"
						rows={2}
						required
						value={exchange.body}
						mix={[
							css(inputCss),
							on('input', (event) =>
								setExchange({ body: event.currentTarget.value }),
							),
						]}
					/>
				</div>
				<div mix={css(fieldCss)}>
					<label
						for="connect-credential-exchange-token"
						mix={css(fieldLabelCss)}
					>
						Token path{' '}
						<span mix={css(labelHintCss)}>(where the response holds it)</span>
					</label>
					<input
						id="connect-credential-exchange-token"
						required
						value={exchange.tokenPath}
						placeholder="data.token"
						mix={[
							css(inputCss),
							on('input', (event) =>
								setExchange({ tokenPath: event.currentTarget.value }),
							),
						]}
					/>
				</div>
			</div>
		</details>
	)
}

function renderKindBody(input: {
	kind: CredentialKind
	search: URLSearchParams
	orgSlug: string
	valueForm: (kind: ValueFormKind) => RemixNode
}) {
	const mode = credentialCreateMode(input.kind)
	switch (mode) {
		case 'value-form':
			return isValueFormKind(input.kind) ? input.valueForm(input.kind) : null
		case 'handoff': {
			const kind = input.kind === 'oauth' ? 'oauth' : 'mcp'
			const provider = input.search.get('provider')?.trim()
			return (
				<section mix={css(cardCss)} data-testid="connect-credential-handoff">
					<p mix={css({ margin: 0 })}>
						{kind === 'oauth'
							? `Kody sends you to ${provider ? `${provider}'s` : 'the provider’s'} sign-in, then brings you back.`
							: 'Add the server’s URL. Kody connects to it and asks you to sign in when the server needs it.'}
					</p>
					<a
						href={credentialCreateHandoffHref({
							kind,
							search: input.search,
							orgSlug: input.orgSlug,
						})}
						mix={css(primaryButtonCss)}
						data-testid="connect-credential-continue"
					>
						{kind === 'oauth'
							? 'Continue to connect'
							: 'Continue to add server'}
					</a>
				</section>
			)
		}
		default: {
			const exhaustive: never = mode
			return exhaustive
		}
	}
}
