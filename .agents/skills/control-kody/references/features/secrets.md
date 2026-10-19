# Secrets

## Seed / reach

```bash
npm run control-kody -- login
npm run control-kody -- request GET /@jane/-/secrets --contains 'Secrets'
```

Create fixtures with `control-kody execute` / `search` (secret capabilities),
not raw D1.

## Assert

- Workspace: `/@{$orgSlug}/-/secrets`, `/@{$orgSlug}/-/credentials`,
  `/@{$orgSlug}/-/secret-providers`
- Connect approvals: `/connect/secrets`, `/connect/secret-set`,
  `/connect/credential`
- Legacy `/account/secrets` redirects or 404s depending on route — prefer org
  URLs
