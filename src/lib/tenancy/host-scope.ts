/**
 * Host → project scope resolution. THE routing table the edge reads.
 *
 * ── Status: LIVE (RENAME.md Step 6 flipped the callers) ──────────────────────
 * `src/proxy.ts` resolves every request through this module: hosts via
 * `resolveScopeFromHost()`, path-based project segments via
 * `resolveScopeFromProjectSegment()` / `defaultLocaleForProjectSegment()`, and
 * the `(website)/[tenant]` route boundary's 404 guard via
 * `isKnownProjectSegment()`. There is no hand-maintained routing table left
 * anywhere in the request path.
 *
 * Everything below is derived from `./generated/route-config.ts`, which is
 * generated from the Supabase `projects`/`tenants` tables by
 * `scripts/generate-route-config.mjs`. Drift is caught by
 * `node scripts/generate-route-config.mjs --check`, wired as a CRITICAL check
 * in `scripts/doctor.sh` (which `scripts/release.sh` runs, and dies on, before
 * it commits, tags or pushes), and echoed by `__tests__/route-config-drift.test.ts`.
 *
 * ── What problem this solves ─────────────────────────────────────────────────
 * The route is `/[locale]/[tenant]/...`. That segment is named `tenant` but is
 * consumed downstream as PROJECT identity — for No!Logo it already carries
 * `nologo`, which is a PROJECT slug whose TENANT is `freeriders`. So the
 * segment is misnamed rather than misdesigned: it is already project-grain.
 *
 * What the platform never had is a way to answer "which TENANT is this?" at the
 * edge without guessing. The old `resolveTenant()` could not: it returned a URL
 * slug that was really a project slug, and there was no tenant anywhere in the
 * request path. Every tenant-owned lookup downstream (forms above all) then had
 * to re-derive ownership from Sanity. This module resolves BOTH grains, at the
 * edge, from one lookup, with no guessing anywhere.
 *
 * ── Why a copy of the database is acceptable here ────────────────────────────
 * Edge middleware cannot query Supabase per request, so a copy near the edge is
 * unavoidable. The rule agreed with Tom is: one source of truth (Supabase);
 * every other copy is GENERATED at build time, never typed by a human.
 *
 * ── Decision D-2: ONE PROJECT = ONE HOST ─────────────────────────────────────
 * A customer with several projects gets `project1.customer.com`,
 * `project2.customer.com` — never `customer.com/project1`. Path-mode was
 * rejected because a project segment collides permanently with client-authored
 * page slugs, and because it shares one origin (cookies, localStorage, CSP)
 * across a customer's projects. `resolveScopeFromHost()` therefore keys on HOST
 * alone and never inspects the path. The generator enforces the other half: two
 * projects claiming one host is a generation-time throw, not a runtime
 * precedence rule.
 *
 * (`resolveScopeFromProjectSegment()` below is NOT path-mode routing. It exists
 * only for the platform's own path-based dev/preview surfaces —
 * `preview.abluo.app/<slug>`, `dev.abluo.app/<slug>` — and for the internal
 * rewrite target `/[locale]/[tenant]`, neither of which is a customer host.)
 *
 * ── What the CONTRACT phase DELETED ──────────────────────────────────────────
 *   1. `domainMap`                (src/proxy.ts) — superseded by
 *      `GENERATED_HOST_ROUTES` rows with hostKind 'custom-domain'/'platform-alias'.
 *   2. `resolveSanityProjectSlug` (src/proxy.ts) — deleted in Step 5. It had
 *      NO callers, and was dead the moment the URL segment and `projects.slug`
 *      became one namespace.
 *   3. `resolveDefaultLocale`     (src/proxy.ts) — superseded by `defaultLocale`
 *      on each row, read through `defaultLocaleForProjectSegment()`. Its comment
 *      asked a human to "keep in sync with the projects table in Supabase";
 *      the generator replaced the human.
 *   4. `TENANT_TO_PROJECT`        (src/lib/sanity/client.ts) — deleted in
 *      Step 5: Step 4 renamed the Sanity documents, so it was an identity map.
 *      Its surviving half, the hand-typed `KNOWN_PROJECT_SEGMENTS` allow-list,
 *      is replaced by `isKnownProjectSegment()` below.
 * `resolveTenant()` in proxy.ts survives, gutted to a call into this module.
 *
 * ── DIVERGENCES FROM THE PRE-STEP-6 proxy.ts ─────────────────────────────────
 * This module was never byte-equivalent to the maps it replaced. The
 * differences are deliberate, and each is asserted in
 * `__tests__/host-scope.test.ts` so it cannot change unnoticed.
 *
 * (A) `abluo.app` / `dev.abluo.app`.  ✅ RESOLVED by Step 1 — the URL segment
 *     was renamed from a longer invention of proxy.ts's own to Supabase's
 *     `abluo` (safe: the segment is an internal rewrite target, never visible
 *     in a browser, and appears in no Sanity document). Kept in this list
 *     because it was a flip-time BLOCKER, and its absence should not be
 *     mistaken for it never having existed.
 *
 * (B) `ch-psicoterapeuta.com` (project `hoffmann`).  ✅ RESOLVED, and the note
 *     that used to live here was STALE by the time Step 6 ran. It said the host
 *     was in none of proxy.ts's maps. By 2026-09-02 somebody had hand-added it
 *     to BOTH `domainMap` and `resolveDefaultLocale` (and `hoffmann` to
 *     `KNOWN_PROJECT_SEGMENTS`, "Onboarded 2026-09-01"), so the flip is a no-op
 *     for that host. That hand-add is itself the argument for this module: the
 *     maps were only correct because somebody remembered three of them.
 *
 *     The project that WAS broken is `amelie`: an active project with no
 *     `custom_domain`, absent from `resolveDefaultLocale` and from
 *     `KNOWN_PROJECT_SEGMENTS`, so `amelie.preview.abluo.app` resolved a
 *     GUESSED slug (divergence C) and then 404'd at the route boundary. It now
 *     resolves and renders. That is the one genuine live behaviour change.
 *
 * (C) Unknown `*.preview.abluo.app` and `*.localhost` subdomains. proxy.ts used
 *     to GUESS: it returned whatever the subdomain said, for any subdomain, and
 *     let the route 404 later. This module returns null for a subdomain that is
 *     not a known ACTIVE project. Fail-closed is the house rule
 *     (`project-scope.ts`: "null MUST mean select nothing, never select
 *     everything"), and a guessed project slug at the edge is precisely how one
 *     tenant's host can be made to render another tenant's route.
 *
 * (D) Sanity `projectSlug`.  ✅ RESOLVED by Steps 4 and 5. `projects.slug` and
 *     Sanity's `projectSlug` are now the same string for every project, so the
 *     `projectSlug` this module returns is BOTH. There is no third field and no
 *     translation left to carry.
 *
 * ── What this module does NOT do ─────────────────────────────────────────────
 *   - No host-shaped guessing. See (C).
 *   - No network, no Supabase, no async. It must run in the edge runtime inside
 *     a request, so it is a pure synchronous lookup over a frozen table.
 *   - No locale negotiation. `defaultLocale` is the project's default; the
 *     cookie/Accept-Language negotiation in proxy.ts is policy and stays where
 *     the request headers are.
 *   - No routing for a project whose status does not serve on the host being
 *     asked about. The row stays in the table either way; `servesOnHostKind()`
 *     decides. `t42` is `inactive` and resolves to null everywhere; a `preview`
 *     project resolves on its preview and localhost hosts only; a `draft`
 *     project resolves nowhere. Only `active` serves on a custom domain.
 */

import {
  asSupabaseProjectSlug,
  asTenantSlug,
  unbrand,
  type SupabaseProjectSlug,
  type TenantSlug,
  type UrlProjectSegment,
} from './ids'
import {
  GENERATED_HOST_ROUTES,
  GENERATED_PLATFORM_HOSTS,
  type GeneratedHostKind,
  type GeneratedHostRoute,
} from './generated/route-config'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The scope a host resolves to: both grains, branded, plus the two facts the
 * edge needs to route (`projectId` for anything that must survive a slug
 * rename, `defaultLocale` for the root-path rewrite).
 */
export interface HostScope {
  /** The CUSTOMER. `tenants.slug`. */
  tenantSlug: TenantSlug
  /** The WEBSITE. `projects.slug`. */
  projectSlug: SupabaseProjectSlug
  /** `projects.id`. Stable across slug and domain renames. */
  projectId: string
  /** `projects.default_locale`. A default, not a negotiated locale. */
  defaultLocale: string
}

// ─── The status ladder ───────────────────────────────────────────────────────

/**
 * The four values of `projects.status`.
 *
 * Mirrors the Supabase check constraint:
 *   `status text not null default 'draft'
 *    check (status in ('draft','preview','active','inactive'))`
 *
 * The row's `status` arrives from the generated table typed as a bare `string`
 * (the generator copies whatever the column holds, so the table cannot promise
 * more than the database does). This union is the set this module KNOWS; a
 * value outside it is handled by `servesOnHostKind()` as "not served".
 */
export const PROJECT_STATUSES = ['draft', 'preview', 'active', 'inactive'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Narrow a raw `projects.status` string to the union this module understands. */
export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value)
}

/**
 * THE routing rule. Does a project with this `status` serve on this `hostKind`?
 *
 * This is the single place the status ladder is expressed. Every status test in
 * this module goes through it, so the ladder cannot be half-applied on one
 * surface and not another.
 *
 * ── The ladder (approved by Tom, 2026-09-03) ─────────────────────────────────
 *
 *   status     custom-domain  platform-alias  preview-subdomain  localhost-subdomain
 *   ─────────────────────────────────────────────────────────────────────────────
 *   draft            ✗              ✗                ✗                   ✗
 *   preview          ✗              ✗                ✓                   ✓
 *   active           ✓              ✓                ✓                   ✓
 *   inactive         ✗              ✗                ✗                   ✗
 *
 *   - `draft` — serves NOWHERE. It is the column DEFAULT, so this is the state
 *     a just-inserted project is born in. Before this predicate existed, that
 *     was indistinguishable from `inactive`, which made a new project silently
 *     unroutable even on its own preview host.
 *
 *   - `preview` — serves ONLY on the two non-public surfaces: the project's
 *     `<slug>.preview.abluo.app` host and its `<slug>.localhost` dev host. The
 *     custom domain and any platform alias stay dark. This is the state that
 *     did not exist before: "my client can review it, the public cannot".
 *
 *   - `active` — serves everywhere, custom domain included. Unchanged.
 *
 *   - `inactive` — serves NOWHERE. Retired. `t42` is the live example.
 *
 * ── `draft` and `inactive` are deliberately IDENTICAL here ───────────────────
 * There is no routing difference between them and there is not meant to be.
 * They differ only in what they tell a human reading the `projects` table:
 * `draft` is "not launched yet", `inactive` is "launched once, retired". Do not
 * try to give them different routing behaviour to justify being two values —
 * the distinction is editorial, and it is worth keeping for that alone.
 *
 * ── FAIL CLOSED ──────────────────────────────────────────────────────────────
 * An unrecognised status (someone widens the DB check constraint and forgets
 * this file) returns FALSE. It never falls through to serving. The `never`
 * assignment in the default branch makes the same mistake a COMPILE error the
 * moment the new value is added to `PROJECT_STATUSES` above, so the two halves
 * are: a type error if you update the union, and a dark site if you do not.
 * Neither is a leak.
 */
export function servesOnHostKind(status: string, hostKind: GeneratedHostKind): boolean {
  if (!isProjectStatus(status)) return false

  switch (status) {
    case 'active':
      // Everywhere, custom domain included.
      return true
    case 'preview':
      // Non-public surfaces only. The customer's own domain stays dark.
      return hostKind === 'preview-subdomain' || hostKind === 'localhost-subdomain'
    case 'draft':
      // Not launched yet. Same routing as `inactive`, different meaning.
      return false
    case 'inactive':
      // Retired. Same routing as `draft`, different meaning.
      return false
    default: {
      // Unreachable while the union above matches the DB check constraint.
      // If it stops matching, this line stops compiling.
      const exhaustive: never = status
      void exhaustive
      return false
    }
  }
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Reduce a raw `Host` header to the form the generated table is keyed by.
 *
 * Mirrors what `proxy.ts:22` does today (`hostname.split(':')[0]` then strip a
 * leading `www.`) and adds three cases that header actually produces and
 * proxy.ts silently gets wrong:
 *
 *   - CASE. Host headers are case-insensitive and browsers do not normalise
 *     them; `Studiomartegani.com` misses `domainMap` today.
 *   - A TRAILING DOT. `studiomartegani.com.` is the fully-qualified form and is
 *     a legal, resolvable host header. It misses `domainMap` today.
 *   - IPv6 LITERALS. `[::1]:3000` — splitting on `:` mangles it into `[`.
 *     Handled so the port strip cannot corrupt the host; the result resolves to
 *     null like any other unknown host, which is correct, but it must fail as
 *     "unknown", not as garbage.
 *
 * A scheme prefix is also tolerated, because callers pass `request.url` by
 * mistake often enough that silently returning null for it wastes an afternoon.
 *
 * MUST stay behaviourally identical to `normalizeHost()` in
 * `scripts/generate-route-config.mjs` — the drift test asserts they agree, and
 * if they ever diverge the table gets keys the resolver can never look up.
 */
export function normalizeHost(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  let h = raw.trim().toLowerCase()
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  h = h.split('/')[0]
  if (h.startsWith('[')) {
    const close = h.indexOf(']')
    if (close !== -1) h = h.slice(0, close + 1)
  } else {
    h = h.split(':')[0]
  }
  h = h.replace(/\.$/, '')
  h = h.replace(/^www\./, '')
  return h
}

// ─── Index ───────────────────────────────────────────────────────────────────

/**
 * Built once at module load. The table is small (tens of rows) and the edge
 * pays for this once per isolate, not once per request. A linear `.find()` per
 * request would also be fine at this size; the Map is here so it stays fine at
 * a thousand projects without anyone having to notice.
 */
const ROUTES_BY_HOST: ReadonlyMap<string, GeneratedHostRoute> = new Map(
  GENERATED_HOST_ROUTES.map((route) => [route.host, route])
)

const PLATFORM_HOST_SET: ReadonlySet<string> = new Set(
  GENERATED_PLATFORM_HOSTS.map((h) => normalizeHost(h))
)

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve a host to its project scope, or `null`.
 *
 * Pure, synchronous, edge-safe. Returns `null` for: an unknown host, a known
 * platform host (`admin.abluo.app`, bare `localhost`, bare `preview.abluo.app`),
 * and a host whose project's `status` does not serve on that host's `hostKind`
 * — see `servesOnHostKind()` for the ladder. It is NOT an active-only test any
 * more: a `preview` project serves on its preview and localhost hosts and stays
 * dark on its custom domain. It NEVER guesses — there is no subdomain-shaped
 * fallback, no "strip the suffix and hope", no default project.
 *
 * `null` must be treated as "this host has no project", never as "use the
 * platform default". Callers that need to tell an unknown host from a platform
 * host should ask `isPlatformHost()`; both are `null` here on purpose, because
 * for ROUTING they are the same answer.
 */
export function resolveScopeFromHost(host: string | null | undefined): HostScope | null {
  const route = lookupHostRoute(host)
  if (!route) return null
  if (!servesOnHostKind(route.status, route.hostKind)) return null
  return {
    tenantSlug: asTenantSlug(route.tenantSlug),
    projectSlug: asSupabaseProjectSlug(route.projectSlug),
    projectId: route.projectId,
    defaultLocale: route.defaultLocale,
  }
}

/**
 * The raw generated row for a host, `status` and `hostKind` included, ignoring
 * the status ladder entirely.
 *
 * For diagnostics, admin tooling and tests — an admin UI wants to say "t42 is
 * configured on t42.preview.abluo.app but is inactive", or "this project is in
 * preview, so it answers here but not on its domain", neither of which
 * `resolveScopeFromHost` can express. NOT for routing: routing must go through
 * `resolveScopeFromHost` so `servesOnHostKind()` cannot be forgotten.
 */
export function lookupHostRoute(
  host: string | null | undefined
): GeneratedHostRoute | undefined {
  const normalized = normalizeHost(host)
  if (!normalized) return undefined
  return ROUTES_BY_HOST.get(normalized)
}

/**
 * True for a host the platform serves on purpose with no project attached.
 * Lets a caller log "unknown host" for a genuine miss without also shouting
 * about every request to `admin.abluo.app`.
 */
export function isPlatformHost(host: string | null | undefined): boolean {
  const normalized = normalizeHost(host)
  return normalized.length > 0 && PLATFORM_HOST_SET.has(normalized)
}

/**
 * Every host row for one project, in table order. Exists for the D-2 invariant:
 * "one project = one host" is about a host never serving two projects, not
 * about a project having one alias, and this is how you see a project's real
 * alias set (apex + preview + localhost, plus the platform's dev alias).
 */
export function hostsForProjectId(projectId: string): readonly GeneratedHostRoute[] {
  return GENERATED_HOST_ROUTES.filter((route) => route.projectId === projectId)
}

// ─── Project URL segments ────────────────────────────────────────────────────

/**
 * `projects.slug` → the scope it names, for projects that serve on the
 * platform's PATH-based preview surfaces.
 *
 * The `[tenant]` URL segment is project-grain (see the header), and since
 * RENAME.md Step 4 a legal segment IS `projects.slug` — there is no second
 * namespace to translate into. So this index answers two questions with one
 * lookup: "is this segment a project at all?" and "what is its default
 * locale?". Both used to be hand-typed, in two different files that disagreed
 * (`resolveDefaultLocale` in proxy.ts knew five projects, `KNOWN_PROJECT_SEGMENTS`
 * in sanity/client.ts knew the same five, and Supabase had six active ones).
 *
 * Built from the same generated rows as the host index rather than from a
 * second generated list: every project emits at least a `<slug>.localhost` row,
 * so no project can be missing from it, and there is nothing extra to keep in
 * step.
 *
 * ── WHICH HOST KIND DOES A SEGMENT GET JUDGED AT? ────────────────────────────
 * `servesOnHostKind()` needs a host kind and this map has none — it is keyed by
 * project segment, and one segment is reachable from several surfaces. It is
 * evaluated at `PROJECT_SEGMENT_HOST_KIND` = `'preview-subdomain'`, because
 * every consumer of this map is a preview-grade surface, never a customer's
 * public domain:
 *
 *   1. `preview.abluo.app/<slug>` — the preview platform. Same surface, same
 *      audience and same DNS as `<slug>.preview.abluo.app`; it would be
 *      incoherent for the two spellings of "preview" to disagree.
 *   2. `dev.abluo.app/<slug>` — the platform's internal dev surface.
 *   3. `isKnownProjectSegment()` — the `(website)/[tenant]` route boundary's
 *      404 guard, which sees the INTERNAL rewrite target `/[locale]/[tenant]`
 *      after proxy.ts has already resolved and approved the host through
 *      `resolveScopeFromHost()`. This one is load-bearing: if the map excluded
 *      `preview` projects, a preview host would resolve at the edge, rewrite,
 *      and then be 404'd by the layout — the ladder would be defeated one hop
 *      downstream. The guard must be at least as permissive as the host
 *      resolver on the most permissive host kind the resolver can approve for a
 *      non-`active` project, and that kind is `preview-subdomain`.
 *
 * So the two status tests in this module are CONSISTENT, not identical: the
 * host resolver judges each host at its own kind, and this map judges a segment
 * at the kind all three of its callers actually are. `draft` and `inactive` are
 * excluded here exactly as they are excluded from every host — `t42` must not
 * serve on any surface, host-based or path-based.
 *
 * ── Known, PRE-EXISTING and unchanged: the fall-through at proxy.ts:446 ──────
 * A host proxy.ts cannot resolve (an unknown domain someone CNAMEs at the
 * deployment) falls through to a last path-segment branch that also reads this
 * map, so `whatever.example.com/<slug>` can path-route to a project. That was
 * already true for every `active` project before this change and is out of
 * scope here; it now extends to `preview` projects too. If that matters, the
 * fix belongs in proxy.ts (do not path-route on an unresolved host), not here.
 */
const PROJECT_SEGMENT_HOST_KIND: GeneratedHostKind = 'preview-subdomain'

const SCOPE_BY_PROJECT_SEGMENT: ReadonlyMap<string, HostScope> = (() => {
  const index = new Map<string, HostScope>()
  for (const route of GENERATED_HOST_ROUTES) {
    if (!servesOnHostKind(route.status, PROJECT_SEGMENT_HOST_KIND)) continue
    if (index.has(route.projectSlug)) continue
    index.set(route.projectSlug, {
      tenantSlug: asTenantSlug(route.tenantSlug),
      projectSlug: asSupabaseProjectSlug(route.projectSlug),
      projectId: route.projectId,
      defaultLocale: route.defaultLocale,
    })
  }
  return index
})()

/**
 * Resolve a `[tenant]` URL segment to its project scope, or `null`.
 *
 * For the platform's own PATH-based surfaces (`preview.abluo.app/<slug>`,
 * `dev.abluo.app/<slug>`) and for the internal `/[locale]/[tenant]` rewrite
 * target. NOT a customer routing mode — see decision D-2 in the header.
 *
 * Exact match only: no normalisation, no case-folding, no trimming. A URL
 * segment is compared byte-for-byte against `projects.slug`, because
 * `/en/Livener` and `/en/livener` must not be two ways of reaching one site.
 */
export function resolveScopeFromProjectSegment(
  segment: string | null | undefined
): HostScope | null {
  if (typeof segment !== 'string' || segment.length === 0) return null
  return SCOPE_BY_PROJECT_SEGMENT.get(segment) ?? null
}

/**
 * The default locale for a project URL segment, or `null` when the segment is
 * not a project this deployment serves on its preview surfaces (see the map
 * above: `active` and `preview` qualify, `draft` and `inactive` do not).
 *
 * Replaces `resolveDefaultLocale()` in proxy.ts, which did the same two jobs
 * from a hand-typed Record: supply a locale, AND act as the "is this a project
 * slug?" test that stops `/login` and `/unauthorized` being rewritten as if
 * they were sites. `null` still means "not a project" — callers must not
 * substitute a default locale for it, or that guard disappears.
 */
export function defaultLocaleForProjectSegment(
  segment: string | null | undefined
): string | null {
  return resolveScopeFromProjectSegment(segment)?.defaultLocale ?? null
}

/**
 * True when `segment` is a `[tenant]` URL segment this deployment serves.
 *
 * This is the `(website)/[tenant]` route boundary's 404 guard: the layout and
 * `generateMetadata` call it and `notFound()` on false, so an unknown segment
 * (a retired flat route, a typo, a dead link falling through to the dynamic
 * segment) produces a clean 404 rather than a 200 with an empty page.
 *
 * ── Lineage, because deleting this by accident is a silent regression ────────
 * It began as the null branch of `tryTenantToProjectSlug()`, survived Step 5 as
 * the hand-typed `KNOWN_PROJECT_SEGMENTS` set in `src/lib/sanity/client.ts`,
 * and is now derived from the generated table. The behaviour it must preserve
 * has never changed: FALSE for anything that is not a project, so the caller
 * 404s. The set it is computed over got one member wider in Step 6 — `amelie`
 * is an active project and was missing from the hand-typed list.
 *
 * Takes the branded `UrlProjectSegment` deliberately: the caller has to have
 * passed the raw param through `asUrlProjectSegment()` at the trust boundary
 * before it can ask this question.
 */
export function isKnownProjectSegment(segment: UrlProjectSegment): boolean {
  return SCOPE_BY_PROJECT_SEGMENT.has(unbrand(segment))
}

export type { GeneratedHostRoute, GeneratedHostKind }
