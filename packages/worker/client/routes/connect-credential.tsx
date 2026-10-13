import { type Handle, type RemixNode, css } from 'remix/component'
import { readCurrentRouterHref } from '#client/client-router.tsx'
import { CopyTextButton } from '#client/copy-text-button.tsx'
import { on } from '#client/event-mixin.ts'
import { tryConsumeRouteLoaderData } from '#client/loader-data-context.tsx'
import { orgAccountApiReferrer } from '#client/org-account-api.ts'
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
import { AccountManagementShell } from '#client/routes/account-management-components.tsx'
import {
	buildKeySaveBody,
	createKeyFormState,
	credentialCreateAgentPrompt,
	credentialCreateHandoffHref,
	credentialCreateMode,
	credentialCreateTitle,
	expiresAtDateValue,
	expiresAtHasTime,
	findExistingOrgKey,
	findMatchingCredentials,
	keyFormPackageId,
	keyFormProblem,
	keyLinkProblem,
	type KeyFormState,
} from '#client/routes/connect-credential-shared.ts'
import {
	renderKindList,
	renderMatches,
	renderPackageAccess,
} from '#client/routes/connect-credential-parts.tsx'
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
import { colors, spacing, typography } from '#universal/styles/tokens.ts'

const accountCredentialsApiPath = routes.accountCredentialsApi.href()

const primaryButtonCss = getPrimaryButtonCss({ size: 'lg', weight: 'semibold' })
const secondaryButtonCss = getSecondaryButtonCss({
	size: 'lg',
	weight: 'semibold',
})

const mutedCss = { margin: 0, color: colors.textMuted }
const errorCss = { margin: 0, color: colors.danger }
const labelHintCss = {
	fontWeight: typography.fontWeight.normal,
	color: colors.textMuted,
}

/**
 * `/connect/credential` has no org; the worker redirects it to the signup
 * org's `/@slug/-/credentials/new`, so leave the SPA and let it.
 */
export async function connectCredentialRedirectLoader(
	url: URL,
): Promise<RouteLoaderResult> {
	return routeLoaderRedirect(`${url.pathname}${url.search}`)
}

export async function connectCredentialRouteLoader(
	url: URL,
	signal: AbortSignal,
): Promise<RouteLoaderResult> {
	const response = await fetch(accountCredentialsApiPath, {
		headers: { Accept: 'application/json' },
		credentials: 'include',
		referrer: orgAccountApiReferrer(url.href),
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

/**
 * `/connect/credential`: the creation link agents hand out. One page picks
 * the kind (fixed when the link requires it), creates a Key in place, and
 * hands OAuth and MCP to their own flows with the link's prefill.
 */
export function ConnectCredentialRoute(handle: Handle) {
	let data: AccountCredentialsResponse | null = null
	let form: KeyFormState | null = null
	let formForHref = ''
	let showValue = false
	let saving = false
	let savedName: string | null = null
	let savedPackageId: string | null = null
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

	async function saveKey(event: SubmitEvent) {
		event.preventDefault()
		if (saving || !form) return
		const current = form
		const problem = keyFormProblem(current)
		if (problem) {
			message = problem
			handle.update()
			return
		}
		const existing = findExistingOrgKey(
			data?.credentials ?? [],
			current.name,
			keyFormPackageId(current),
		)
		if (existing && !current.replaceExisting) {
			message = `A key named ${current.name.trim()} already exists. Choose “Replace its value” or pick another name.`
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
				body: JSON.stringify(buildKeySaveBody({ form: current, existing })),
			})
			if (response.status === 401) {
				window.location.assign(
					`/login?redirectTo=${encodeURIComponent(readCurrentRouterHref(handle))}`,
				)
				return
			}
			const payload = await readJson<{ ok?: boolean; error?: string }>(response)
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.error || 'Unable to save this key.')
			}
			savedName = current.name.trim()
			savedPackageId = keyFormPackageId(current)
			form = { ...current, value: '' }
			await refreshCredentials()
		} catch (error) {
			message = error instanceof Error ? error.message : 'Unable to save.'
		} finally {
			saving = false
			handle.update()
		}
	}

	function renderKeyForm(input: {
		state: KeyFormState
		existing: CredentialListItem | null
		orgSlug: string
		packages: AccountCredentialsResponse['packages']
		linkProblem: string | null
	}) {
		const { state, existing } = input
		const update = (patch: Partial<KeyFormState>) => {
			form = { ...state, ...patch }
			handle.update()
		}
		if (savedName) {
			const saved = findExistingOrgKey(
				data?.credentials ?? [],
				savedName,
				savedPackageId,
			)
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
							void saveKey(event)
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
							Code refers to it as{' '}
							<code>{`{{secret:${state.name || 'NAME'}}}`}</code>.
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
								A key named <code>{existing.name}</code> already exists. Replace
								its value (its hosts and package locks stay).
							</span>
						</label>
					) : null}
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
							placeholder="Paste the value"
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
					<div mix={css(fieldCss)}>
						<label for="connect-credential-hosts" mix={css(fieldLabelCss)}>
							Allowed hosts <span mix={css(labelHintCss)}>(one per line)</span>
						</label>
						<textarea
							id="connect-credential-hosts"
							rows={2}
							value={state.hosts}
							placeholder="api.example.com"
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({ hosts: event.currentTarget.value }),
								),
							]}
						/>
						<span mix={css(mutedCss)}>
							Kody fills the value only on HTTPS requests to these hosts.
						</span>
					</div>
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
					{renderPackageAccess({
						state,
						packages: input.packages,
						update,
					})}
					<div mix={css(fieldCss)}>
						<label for="connect-credential-expires" mix={css(fieldLabelCss)}>
							Expires <span mix={css(labelHintCss)}>(optional)</span>
						</label>
						<input
							id="connect-credential-expires"
							type="date"
							value={expiresAtDateValue(state.expiresAt)}
							mix={[
								css(inputCss),
								on('input', (event) =>
									update({ expiresAt: event.currentTarget.value }),
								),
							]}
						/>
						{expiresAtHasTime(state.expiresAt) ? (
							<span
								mix={css(mutedCss)}
								data-testid="connect-credential-expires-time"
							>
								The link sets {state.expiresAt} (UTC). Pick a date to change it.
							</span>
						) : null}
						{existing?.expiresAt &&
						state.replaceExisting &&
						!state.expiresAt ? (
							<span mix={css(mutedCss)}>
								Leave empty to keep its current expiry.
							</span>
						) : null}
					</div>
					{input.linkProblem ? (
						<p
							mix={css(errorCss)}
							data-testid="connect-credential-link-problem"
						>
							{input.linkProblem}
						</p>
					) : null}
					{message ? (
						<p mix={css(errorCss)} data-testid="connect-credential-message">
							{message}
						</p>
					) : null}
					<button
						type="submit"
						disabled={saving || input.linkProblem !== null}
						data-testid="connect-credential-save"
						mix={css(primaryButtonCss)}
					>
						{saving ? 'Saving…' : 'Save key'}
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
		const packages = data?.packages ?? []
		const existing = findExistingOrgKey(
			data?.credentials ?? [],
			state.name,
			keyFormPackageId(state),
		)
		const linkProblem = data ? keyLinkProblem({ query, packages }) : null
		const scopedPackage =
			query.packageScopedTo === null
				? null
				: (packages.find((entry) => entry.id === query.packageScopedTo) ?? null)
		const pageUrl =
			typeof window === 'undefined'
				? href
				: new URL(href, window.location.origin).toString()

		return (
			<AccountManagementShell>
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
							{scopedPackage ? (
								<>
									Only <code>{scopedPackage.kodyId}</code> can read this
									key.{' '}
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
						{renderKindList({ kinds, selected, href })}
					</section>

					{selected === null
						? null
						: renderKindBody({
								kind: selected,
								search,
								orgSlug,
								prompt: credentialCreateAgentPrompt({
									kind: selected,
									query,
									pageUrl,
								}),
								keyForm: () =>
									renderKeyForm({
										state,
										existing,
										orgSlug,
										packages,
										linkProblem,
									}),
							})}
				</section>
			</AccountManagementShell>
		)
	}
}

function renderKindBody(input: {
	kind: CredentialKind
	search: URLSearchParams
	orgSlug: string
	prompt: string
	keyForm: () => RemixNode
}) {
	const mode = credentialCreateMode(input.kind)
	switch (mode) {
		case 'key-form':
			return input.keyForm()
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
		case 'unavailable':
			return (
				<section
					mix={css({ ...cardCss, border: `1px dashed ${colors.border}` })}
					data-testid="connect-credential-unavailable"
				>
					<p mix={css({ margin: 0 })}>
						Creating a {credentialKindLabel(input.kind)} credential on the
						website is not available yet.
					</p>
					<p mix={css(mutedCss)}>
						Copy this prompt for your agent. It can suggest another way to meet
						the need without you pasting the value into chat.
					</p>
					<CopyTextButton
						value={input.prompt}
						idleLabel="Copy prompt for your agent"
						variant="primary"
					/>
				</section>
			)
		default: {
			const exhaustive: never = mode
			return exhaustive
		}
	}
}
