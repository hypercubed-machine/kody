# Account hub

## Seed / reach

```bash
npm run control-kody -- login
npm run control-kody -- request GET /account --contains 'Account'
npm run control-kody -- browse --path /account
npm run control-kody -- request GET /account/organizations --contains 'Organizations'
```

Create a team org (form POST), then use `/@<slug>/-/…` workspace pages:

```bash
npm run control-kody -- request POST /account/organizations/new \
  --form slug=x-org --form displayName=X
```

## Assert

- Person: `/account`, `/account/security`, `/account/data`,
  `/account/organizations`, `/account/organizations/new`
- Export: `GET /account/export.json`
- Team org: `/@{$orgSlug}/-/overview`, `/@{$orgSlug}/-/settings`,
  `/@{$orgSlug}/-/members`, `/@{$orgSlug}/-/teams`, `/@{$orgSlug}/-/grants`,
  `/@{$orgSlug}/-/collaborators`
- Invite: `/join/$token`

Do not delete the shared preview seed to prove account deletion.
