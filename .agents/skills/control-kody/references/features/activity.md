# Activity

## Seed / reach

```bash
npm run control-kody -- login
npm run control-kody -- request GET /@{$orgSlug}/-/activity --contains 'Activity'
```

## Assert

- `/@{$orgSlug}/-/activity`, `/@{$orgSlug}/-/activity/$runId`
- Legacy `/account/activity`
