import { type Handle, css } from 'remix/component'
import {
	mutedLinkCss,
	pageDescriptionCss,
	pageHeaderCss,
	pageTitleCss,
	stackedPageCss,
} from '#universal/styles/style-primitives.ts'

/**
 * `/contact`: how to reach the hosted kody.codes operator. Distinct from
 * `/support` (troubleshooting tips) but shares the same inbox.
 */
export function ContactRoute(_handle: Handle) {
	return () => (
		<section mix={css(pageCss)}>
			<header mix={css(pageHeaderCss)}>
				<h1 mix={css(pageTitleCss)}>Contact</h1>
				<p mix={css(pageDescriptionCss)}>
					For the hosted Kody service at kody.codes, email{' '}
					<a href="mailto:support@kody.codes" mix={css(mutedLinkCss)}>
						support@kody.codes
					</a>
					. Kent C. Dodds operates that deployment and is the data controller
					described on the{' '}
					<a href="/privacy" mix={css(mutedLinkCss)}>
						Privacy
					</a>{' '}
					page. A separately operated Kody deployment has its own operator —
					contact that operator, not this inbox.
				</p>
			</header>

			<p mix={css(pageDescriptionCss)}>
				Use this address for account access problems, billing questions about
				kody.codes plans, privacy requests for the hosted service, security
				reports that do not belong in a public GitHub issue, and product
				feedback about the hosted cloud. Include your account email or username
				when it helps. We do not provide support for third-party agent hosts
				(ChatGPT, Claude, Cursor, Codex, and others); those products have their
				own channels. If something feels off in a Kody-connected session, try
				the same request with a stronger model before writing in — stronger
				models usually get more out of search, packages, and memory.
			</p>

			<p mix={css(pageDescriptionCss)}>
				Community chat is on{' '}
				<a href="/discord" mix={css(mutedLinkCss)}>
					Discord
				</a>
				. Open-source discussion and contributions belong on{' '}
				<a
					href="https://github.com/kentcdodds/kody"
					mix={css(mutedLinkCss)}
					target="_blank"
					rel="noreferrer noopener"
				>
					GitHub
				</a>
				. Site blocked by a DNS filter, or signup mail never arrives? See{' '}
				<a href="/docs/cant-open-or-get-mail" mix={css(mutedLinkCss)}>
					If you can&apos;t open kody.codes or get mail from us
				</a>
				. For a longer product overview, see{' '}
				<a href="/about" mix={css(mutedLinkCss)}>
					About
				</a>
				.
			</p>

			<p mix={css({ margin: 0 })}>
				<a href="mailto:support@kody.codes" mix={css(mutedLinkCss)}>
					support@kody.codes
				</a>
				{' · '}
				<a href="/support" mix={css(mutedLinkCss)}>
					Support tips
				</a>
				{' · '}
				<a href="/faq" mix={css(mutedLinkCss)}>
					FAQ
				</a>
				{' · '}
				<a href="/privacy" mix={css(mutedLinkCss)}>
					Privacy
				</a>
			</p>
		</section>
	)
}

const pageCss = {
	...stackedPageCss,
	maxWidth: '42rem',
	margin: '0 auto',
}
