# kody agent index

Kody is Your agents' cloud for individuals and teams (orgs, teams, grants): each
account holds isolated packages, jobs, credentials, memories, remote connectors,
email inboxes, and durable storage.

`npm run validate` is the single authoritative local gate.

For UI and API changes, verify locally with the control-kody CLI (`dev`,
`login`, `browse`, `request`, `execute`) before opening or merging a PR. Use a
PR preview only when local cannot exercise the change (Workers / service
bindings, Durable Objects, real OAuth or inbound third-party webhooks,
deploy/wrangler/config, Artifacts/`packageSave`, or other production-like
surfaces). See [control-kody](./docs/contributing/control-kody.md) and
[Local limitations](./docs/contributing/cloud-agents.md#local-limitations).

Open the page that owns the task:

- Contributor documentation map:
  [docs/contributing/index.md](./docs/contributing/index.md)
- Engineering principles: [docs/principles/](./docs/principles/index.md)
- Task skills: [`.agents/skills/`](./.agents/skills/)

Cloud Agent VM gotchas (Node on `PATH`, Playwright install, dev server, seeding,
local limitations):
[docs/contributing/cloud-agents.md](./docs/contributing/cloud-agents.md)
