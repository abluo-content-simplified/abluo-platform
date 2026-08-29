# Raw `sanityClient` call sites — refactor worklist

**Point-in-time snapshot. Generated 2026-08-29. Not auto-updated — re-run the
command below rather than trusting this list.**

## What this is

`eslint.config.mjs` carries a `no-restricted-imports` guard
(`abluo/no-raw-sanity-client`) that **warns** — it does not error — when a file
imports the raw `sanityClient` export from `@/lib/sanity/client`.

The intent: every Sanity read should go through
`tenantClient(tenantSlug).fetchForTenant`, which injects the project scope. The
raw client has no scope, so a query written against it returns documents across
all projects unless the GROQ filter happens to constrain them by hand.

This file is the worklist of files that trip that warning, so the migration can
be done deliberately, one call site at a time. **It is a snapshot, not a source
of truth** — the live list is whatever the linter says today.

Regenerate with:

```bash
cd <repo root>
npx eslint . 2>&1 | grep -B0 "no-restricted-imports"
# or, for just the rule, machine-readable:
npx eslint . -f json | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));for(const f of r)for(const m of f.messages)if(m.ruleId==='no-restricted-imports')console.log(f.filePath+':'+m.line)"
```

## Snapshot — 5 call sites (all `warning`, 0 errors)

| # | File | Line | Notes |
|---|------|------|-------|
| 1 | `src/lib/forms/definition-source.ts` | 22 | `import { sanityClient } from '@/lib/sanity/client'` |
| 2 | `src/lib/notifications/branding.ts` | 14 | `import { tryTenantToProjectSlug, sanityClient } from '@/lib/sanity/client'` — already resolves a project slug next to the raw client, so likely a direct `fetchForTenant` swap |
| 3 | `src/lib/notifications/recipients.ts` | 13 | same shape as `branding.ts` |
| 4 | `src/lib/sanity/image.ts` | 2 | image-URL builder; may legitimately need the unscoped client (image CDN config, not a content read) — decide whether to refactor or add an exemption with a comment |
| 5 | `src/sanity/client.ts` | 2 | `export * from '@/lib/sanity/client'` — a re-export barrel, so it re-exports `sanityClient` wholesale. Not itself a scoping bypass, but it is a second door to the raw client. Worth narrowing to an explicit named re-export list that omits `sanityClient`. |

### Not caught by the rule (found by grep, listed so it is not lost)

| File | Line | Why the rule misses it |
|------|------|------------------------|
| `src/app/sitemap.ts` | 46 | `const { sanityClient } = await import('@/lib/sanity/client')` — a **dynamic** `import()` with destructuring. `no-restricted-imports` only inspects static `import` declarations, so this is invisible to the linter. It is a genuine unscoped read (`sanityClient.fetch(...)` over all `project` docs) — though arguably correct here, since a sitemap is meant to span every project. Review, then either refactor or leave a comment explaining the exemption. |

## Exemptions (rule turned off)

| Path | Why |
|------|-----|
| `src/lib/sanity/client.ts` | Defines the client. Cannot warn about itself. |
| `src/lib/api/tenant-scoped-sanity.ts` | The tenant-scoped chokepoint — this *is* the `fetchForTenant` wrapper the rule points people at, so it must hold the raw client. |
| `**/__tests__/**`, `**/*.test.{ts,tsx}`, `**/*.spec.{ts,tsx}` | Tests import the raw client to mock/stub it or to assert on scoping behaviour. Warning here would put permanent, un-actionable noise on this worklist without describing any production scoping bypass. Two files currently rely on this: `src/lib/forms/__tests__/definition-source.test.ts` and `src/lib/forms/__tests__/submissions-tenant-isolation.test.ts`. |

## Status

- Rule severity: **warn**. It does not fail `npx eslint .`, and it contributes
  zero errors to the repo's lint exit code.
- `npx tsc --noEmit` is unaffected by the rule (ESLint config is not part of
  the TypeScript program).
