---
id: versioning_and_deprecation
title: Versioning and deprecation
summary:
  How Kody changes public contracts without breaking users — additive changes by
  default, phased migration with codemods, and deprecation windows sized to
  impact.
category: platform
---

# Versioning and deprecation

Kody does not break users on purpose. Public contracts — Open API paths and
`operationId` values, capability names and fields, MCP tool shapes, package
import patterns the platform ships, and documented HTTP headers — stay usable
while we migrate. Prefer additive change. When a breaking change is unavoidable,
ship a phased migration with codemods (or an equivalent automated fix) and a
deprecation window proportional to impact.

## What we treat as a contract

Once real accounts can reference something from saved packages, jobs, tokens, or
published docs, treat it as a compatibility surface:

- Open API `/v1` operations (`operationId`, method + path, documented fields)
- Built-in capability names, input fields, and output fields
- MCP `search` / `execute` / `api` tool envelopes agents already call
- Platform package APIs and documented import patterns
- Documented response headers such as `Retry-After` on HTTP 429

Within Open API `v1`, changes are additive. A new major URL prefix is how a
non-additive API rewrite would ship — not silent renames inside `v1`.

## How breaking changes ship

1. **Land the new shape** behind shims, aliases, or dual behavior so existing
   callers keep working.
2. **Automate the move** with package codemods (detect → dry-run → canary →
   fleet apply) when user source is involved. See the contributor
   [package codemods](../contributing/package-codemods.md) rollout doctrine.
3. **Announce and wait** for a deprecation window sized to impact: short for
   rare or preview surfaces; longer when many accounts, saved packages, or
   headless tokens depend on the old path. High-impact removals include owner
   notice when a scan finds packages a codemod cannot fix.
4. **Enforce for new work** (publish-time checks, runtime warnings that become
   errors) only after the window, then remove the shim when nothing needs it.

Skipping the automated migration or the wait is how silent breakage happens. If
a leftover shim must stay after enforcement, open a tracked follow-up rather
than leaving an undocumented trap.

## What this is not

This policy is about platform and API compatibility. User packages do not get
semver release pins or import version locks — that is a separate product
decision ([ADR 0001](../contributing/decisions/0001-no-package-versioning.md)).
Self-hosted operators still choose when to upgrade their deployment.

## Related

- [No breaking changes](../principles/no-breaking-changes.md) — engineering
  principle this policy applies to public surfaces
- [Kody Open API](./open-api.md) — HTTPS surface and error envelope
- [Local CLI execute](./local-execute.md) — CapabilityProxy / package-graph hop
