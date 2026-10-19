# Waiting inbox

## Seed / reach

```bash
npm run control-kody -- login
npm run control-kody -- request GET /@jane/-/waiting --dump --contains 'Waiting'
npm run control-kody -- browse --path /@jane/-/waiting
```

Seed accounts usually still show first-use setup cards until gates clear. Create
pending grants or locked packages via `execute` / UI before asserting empty.

## Assert

- `/@{$orgSlug}/-/waiting`, `/account/waiting`
- Error-rate card counts **open** Activity errors in the last 7 days only
