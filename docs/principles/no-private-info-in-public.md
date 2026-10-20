# No private information in public spaces

Never post private information in public spaces: issues, PRs, comments, commits,
or public docs. That covers production user or org handles, package names,
emails, credential or secret details, internal IDs, and private-repo or advisory
details. Keep named rows in private channels. Reports use counts or aggregates
(or opaque short refs when a stable token is required).

## Enforcement

`@kentcdodds/github` blocks `@`-mentions by default when posting; pass an
explicit `allowedMentions` array only when the intent is to ping those people.
That is the hard block for mentions. This principle still applies to every other
class of private detail — a mention block does not make package names or emails
safe to paste.

## Application: fleet / admin progress

When an admin or fleet result includes per-row names (for example credential
stamp scan `outcomes`), public progress posts use the counts-only rollup
(`githubSafeSummary` / `remainingByOwner.summary`), not the named rows. Helpers:
`packages/worker/src/admin/github-safe-production-summary.ts`.

## Related

- [Security](../contributing/security.md)
- [Keep agent context lean](./lean-agent-context.md)
