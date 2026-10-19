# Packages

## Seed / reach

Preview seed has no packages until you create one. Local seed may already have
fixtures after `node tools/seed-test-data.ts --local`.

```bash
npm run control-kody -- login
npm run control-kody -- package-create --package-name demo-pkg
npm run control-kody -- request GET /@{$username} --contains 'Repositories'
npm run control-kody -- request GET /account/packages.json --contains 'packages'
```

`package-create` needs the remote `ARTIFACTS` binding — use a PR preview origin,
not `npm run dev`, when proving create/publish. See cloud-agents local
limitations.

## Assert

- Profile / detail: `/@{$username}`, `/@{$username}/$kodyId`,
  `/@{$username}/$kodyId/settings`, `/@{$username}/$kodyId/approve-publish`
- Raw bytes: `/@{$username}/$kodyId/raw/$ref/$`
- Org list: `/@{$orgSlug}/-/repositories` (legacy `/@{$orgSlug}/-/packages`
  301s)
- JSON list: `/account/packages.json`
