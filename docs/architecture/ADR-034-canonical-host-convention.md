# ADR-034 — Canonical host convention (apex redirects to www)

**Status:** Accepted — Tom, 2026-10-13
**Supersedes nothing. Closes a question that had been reopened four times.**

## Context

Every Abluo client domain is wired identically in Vercel:

| Host | Role |
| --- | --- |
| `example.com` (apex) | 308 permanent redirect to the www host |
| `www.example.com` | assigned to Production — this is what serves |

True without exception for `livener.net`, `nologo.cloud`, `studiomartegani.com`,
`ch-psicoterapeuta.com`, `ameliez.com` and `tmz.it`.

Meanwhile `project.customDomain` in Sanity held the **apex** on all nine
projects. That field is the single input to `canonicalOrigin()`, which produces
the canonical tag, the hreflang set, `og:url` and every sitemap URL. So every
site declared a canonical pointing at a URL that immediately 308s to the host
actually serving it — telling Google "the real address is X" where X is a
redirect to Y.

Not harmful (Google follows the redirect and consolidates on the target), but
self-contradictory, and it made the setup look wrong to anyone auditing it.
Which is how it kept getting reopened, each time with a proposal to flip Vercel
to apex-primary — the wrong half of the problem.

## Decision

**1. The Vercel wiring is correct and is not up for discussion.** Apex
308-redirects to www; www serves. Do not propose flipping a project to
apex-primary. The reasons are operational, not SEO:

- **DNS.** A CNAME is not permitted at a zone apex, so a naked domain must be
  an A record pinned to an IP (`216.198.79.1` today). If Vercel moves, every
  apex-pinned site breaks until someone edits DNS at the registrar. A `www`
  host is a plain CNAME and follows automatically.
- **Cookies.** A cookie set on an apex is sent to every subdomain beneath it.
  Scoped to `www` it stays put — which matters on a platform that grows
  subdomains.

Apex and www rank identically. There is no SEO argument either way, and anyone
who opens this thread again should be pointed at this paragraph.

**2. The canonical host is DERIVED, not stored.** `canonicalOrigin()` in
`src/lib/seo/canonical.ts` normalises whatever is stored and applies
`CANONICAL_HOST_PREFIX`. `tmz.it`, `www.tmz.it`, `https://TMZ.IT/` and `tmz.it.`
all yield exactly `https://www.tmz.it`.

Storing the www form per project would also have worked, but it is N records
that project N+1 can silently get wrong. That failure mode is not theoretical:
`customDomain`, `projectSlug` and `status` were each found null on exactly one
project (tmz), each silently disabling a different feature, because a project
created by script skips what the UI would have set. A platform-wide convention
belongs in platform code, where there is one of it.

**3. Host matching normalises both sides.** Anything comparing a request host
to a stored domain must normalise both (`normalizeHost`) or accept either
spelling. `sitemap.ts` already did; `llms.txt/route.ts` did not and would have
started 404ing on every site the moment a www value was stored.

## Consequences

- No data migration. The nine `customDomain` rows keep the apex; the derivation
  makes them correct. Changing the convention later is one constant.
- The sitemap builds its URLs through `canonicalOrigin()` rather than
  interpolating, so it cannot disagree with the canonical tag.
- Google Search Console and GA4 are unaffected: `resolveCanonicalSiteUrl()`
  already follows redirects to find the serving host and registered the www
  property regardless of this field.
- Locked by `src/lib/seo/__tests__/canonical.test.ts`, which asserts the www
  output and the idempotence of every stored spelling.

## If a client ever needs apex-primary

Add an explicit per-project override **then**, with the Vercel change made in
the same breath. Do not add a second source of truth on spec.
