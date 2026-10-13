import {
	type RouteLoaderResult,
	routeLoaderRedirect,
} from '#client/route-loader.ts'
import { readJson } from '#client/routes/account-approval-shared.ts'
import {
	type CommunityDetailApiPayload,
	type CommunityPackageMovedPayload,
} from '#client/routes/community-detail-shared.ts'
import { type PackageCredentialsView } from '#universal/credential-contracts.ts'
import {
	type PackageCredentialsLoaderData,
	readPackageCredentialsTabPath,
} from '#universal/package-credentials-page.ts'
import { routes } from '#universal/routes.ts'

export type PackageCredentialsLoadResult =
	| { kind: 'data'; data: PackageCredentialsLoaderData }
	| { kind: 'redirect'; to: string }

function loginRedirect(href: string) {
	return `/login?redirectTo=${encodeURIComponent(href)}`
}

/**
 * The package detail (for the tab chrome) and the package credentials view,
 * fetched together. A viewer who cannot run the package gets not found, as
 * the API answers. A credentials API failure keeps the chrome and reports
 * the error so the tab can offer a prompt for the person's agent.
 */
export async function loadPackageCredentialsPage(
	href: string,
	signal: AbortSignal,
): Promise<PackageCredentialsLoadResult> {
	const url = new URL(href, 'http://localhost')
	const path = readPackageCredentialsTabPath(url.pathname)
	if (!path) return { kind: 'data', data: { ok: false, notFound: true } }
	const params = { username: path.username, kodyId: path.kodyId }
	const init = { headers: { Accept: 'application/json' }, signal }
	const [detailResponse, viewResponse] = await Promise.all([
		fetch(routes.communityPackageApi.href(params), init),
		fetch(routes.communityPackageCredentialsApi.href(params), {
			...init,
			credentials: 'include',
		}),
	])
	if (detailResponse.status === 401 || viewResponse.status === 401) {
		return {
			kind: 'redirect',
			to: loginRedirect(`${url.pathname}${url.search}`),
		}
	}
	const detail = await readJson<
		CommunityDetailApiPayload | CommunityPackageMovedPayload
	>(detailResponse)
	if (detailResponse.status === 404) {
		const movedTo = detail && !detail.ok ? detail.redirectTo : null
		if (movedTo) return { kind: 'redirect', to: `${movedTo}/${path.tab}` }
		return { kind: 'data', data: { ok: false, notFound: true } }
	}
	if (!detailResponse.ok || !detail?.ok) {
		throw new Error('Unable to load this package.')
	}
	const ownerPackage = detail.ownerPackage
	if (!ownerPackage || !detail.viewerIsOwner || viewResponse.status === 404) {
		return { kind: 'data', data: { ok: false, notFound: true } }
	}
	const viewPayload = await readJson<
		PackageCredentialsView | { ok: false; error?: string }
	>(viewResponse)
	const view = viewResponse.ok && viewPayload?.ok ? viewPayload : null
	const viewError = view
		? null
		: (viewPayload && !viewPayload.ok ? viewPayload.error : null) ||
			`Kody could not load this package’s credentials (HTTP ${viewResponse.status}).`
	return {
		kind: 'data',
		data: {
			ok: true,
			shell: {
				username: detail.username,
				kodyId: detail.kodyId || ownerPackage.kodyId,
				name: ownerPackage.name,
				description: ownerPackage.description ?? '',
				isPrivate: detail.isPrivate ?? ownerPackage.isPrivate,
				isListed: ownerPackage.hasCommunityListing === true,
				listingId: detail.listing?.id ?? null,
				defaultBranch: detail.listing?.defaultBranch ?? null,
				publishedCommit: ownerPackage.publishedCommit ?? null,
				ownerProfilePublic: detail.ownerProfilePublic,
				viewerCanManage: detail.viewerCanManage,
			},
			view,
			viewError,
		},
	}
}

export async function packageCredentialsRouteLoader(
	url: URL,
	signal: AbortSignal,
): Promise<RouteLoaderResult> {
	const result = await loadPackageCredentialsPage(
		`${url.pathname}${url.search}`,
		signal,
	)
	return result.kind === 'redirect'
		? routeLoaderRedirect(result.to)
		: { packageCredentials: result.data }
}
