import { type Handle, css } from 'remix/component'
import {
	mutedLinkCss,
	pageDescriptionCss,
	pageHeaderCss,
	pageTitleCss,
	stackedPageCss,
} from '#universal/styles/style-primitives.ts'

/**
 * `/about`: who runs hosted Kody and what the product is. Facts only — no
 * invented company story, headcount, or funding claims.
 */
export function AboutRoute(_handle: Handle) {
	return () => (
		<section mix={css(pageCss)}>
			<header mix={css(pageHeaderCss)}>
				<h1 mix={css(pageTitleCss)}>About</h1>
				<p mix={css(pageDescriptionCss)}>
					Kody is Your agents&apos; cloud for individuals and teams (orgs,
					teams, and grants). You keep using the AI agent you already have —
					Claude, ChatGPT, Cursor, Codex, Copilot, Grok, OpenClaw, or any other
					MCP-capable host — and connect it to your Kody account. That agent
					gains durable state that outlives the conversation and keeps working
					while your computer is off. Connect a second agent tomorrow and it
					finds the same home already furnished.
				</p>
			</header>

			<p mix={css(pageDescriptionCss)}>
				There is no Kody chat app. Your agent supplies the intelligence; Kody
				supplies the things that should not live in one chat window: durable
				memory, credentials your code can use but your agent never reads,
				reusable packages with typed inputs, jobs and webhooks that run with no
				model in the loop, integrations and MCP servers you own, and an inbox
				every account gets. Search and indexing use a small embedding model;
				that is not a chat model and is not billed as inference. Kody runs no
				chat-model agent loop and bills no chat tokens.
			</p>

			<p mix={css(pageDescriptionCss)}>
				The hosted service at kody.codes is operated by Kent C. Dodds. Kody is
				Fair Source: the source is available to{' '}
				<a
					href="https://github.com/kentcdodds/kody"
					mix={css(mutedLinkCss)}
					target="_blank"
					rel="noreferrer noopener"
				>
					read, fork, and self-host on GitHub
				</a>
				, and each version converts to the Apache License 2.0 after two years.
				Data for the hosted service is processed in the United States on
				Cloudflare&apos;s network. A free plan is available; see{' '}
				<a href="/pricing" mix={css(mutedLinkCss)}>
					pricing
				</a>
				. Beliefs behind the product are on{' '}
				<a href="/believe" mix={css(mutedLinkCss)}>
					What we believe
				</a>
				.
			</p>

			<p mix={css({ margin: 0 })}>
				<a href="/contact" mix={css(mutedLinkCss)}>
					Contact
				</a>
				{' · '}
				<a href="/support" mix={css(mutedLinkCss)}>
					Support
				</a>
				{' · '}
				<a href="/privacy" mix={css(mutedLinkCss)}>
					Privacy
				</a>
				{' · '}
				<a href="/docs" mix={css(mutedLinkCss)}>
					Docs
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
