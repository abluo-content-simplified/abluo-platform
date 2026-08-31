/**
 * Host → project scope resolution (EXPAND phase — built, callable, UNCALLED).
 *
 * ── Read this first: nothing imports this module ─────────────────────────────
 * This is the expand half of an expand/migrate/contract, and it is deliberately
 * inert. No route, layout, page or middleware imports it; `src/proxy.ts` is
 * untouched and still resolves hosts with its own three hand-maintained maps.
 * That is the same shape `./project-scope.ts` was landed in during its expand
 * phase: correct, tested, and reachable only from its tests, so that the risky
 * part (flipping the callers) is a separate, revertible change with its own
 * review. If you are about to "just wire it up while you're in here" — don't;
 * read the divergence register below first, because flipping is NOT a no-op.
 *
 * ── What problem this solves ─────────────────────────────────────────────────
 * The route is `/[locale]/[tenant]/...`. That segment is named `tenant` but is
 * consumed downstream as PROJECT identity — for No!Logo it already carries
 * `nologo`, which is a PROJECT slug whose TENANT is `freeriders`. So the
 * segment is misnamed rather than misdesigned: it is already project-grain.
 *
 * What the platform has never had is a way to answer "which TENANT is this?"
 * at the edge without guessing. `proxy.ts` cannot: `resolveTenant()` returns a
 * URL slug that is really a project slug, and there is no tenant anywhere in
 * the request path. Every tenant-owned lookup downstream (forms above all) then
 * has to re-derive ownership from Sanity. This module resolves BOTH grains, at
 * the edge, from one lookup, with no guessing anywhere.
 *
 * ── Why a copy of the database is acceptable here ────────────────────────────
 * Edge middleware cannot query Supabase per request, so a copy near the edge is
 * unavoidable. The rule agreed with Tom is: one source of truth (Supabase);
 * every other copy is GENERATED at build time, never typed by a human. This
 * module reads `./generated/route-config.ts`, which is exactly that — see
 * `scripts/generate-route-config.mjs`, and the drift test that fails if the
 * checked-in copy stops matching the database.
 *
 * ── Decision D-2: ONE PROJECT = ONE HOST ─────────────────────────────────────
 * A customer with several projects gets `project1.customer.com`,
 * `project2.customer.com` — never `customer.com/project1`. Path-mode was
 * rejected because a project segment collides permanently with client-authored
 * page slugs, and because it shares one origin (cookies, localStorage, CSP)
 * across a customer's projects. This module therefore keys on HOST alone and
 * never inspects the path. The generator enforces the other half: two projects
 * claiming one host is a generation-time throw, not a runtime precedence rule.
 *
 * ── What the CONTRACT phase will delete ──────────────────────────────────────
 * Once callers are flipped and the divergences below are settled:
 *   1. `domainMap`                (src/proxy.ts ~:32)  — superseded by
 *      `GENERATED_HOST_ROUTES` rows with hostKind 'custom-domain'/'platform-alias'.
 *   2. `resolveSanityProjectSlug` (src/proxy.ts ~:56)  — an incomplete second
 *      copy of `TENANT_TO_PROJECT`; it is dead the moment the URL segment and
 *      `projects.slug` are the same namespace.
 *   3. `resolveDefaultLocale`     (src/proxy.ts ~:73)  — superseded by
 *      `defaultLocale` on each row. Its comment already asks a human to "keep
 *      in sync with the projects table in Supabase"; this replaces the human.
 *   4. `TENANT_TO_PROJECT`        (src/lib/sanity/client.ts ~:71) — the
 *      URL-slug → Sanity-projectSlug translation. It survives only until the
 *      `livener` / `livener-main` split is reconciled; see divergence (D) below.
 * `resolveTenant()` itself stays, gutted to a call into this module.
 *
 * ── KNOWN DIVERGENCES FROM proxy.ts TODAY ────────────────────────────────────
 * This module is NOT byte-equivalent to `proxy.ts` and pretending otherwise
 * would be the dangerous thing. Four differences, all deliberate, all verified
 * against the live database on 2026-08-31. They are asserted explicitly in
 * `__tests__/host-scope.test.ts` so they cannot change unnoticed.
 *
 * (A) `abluo.app` / `dev.abluo.app`.  ✅ RESOLVED — no longer a divergence.
 *     HISTORY, kept because it was a flip-time BLOCKER and its absence should
 *     not be mistaken for it never having existed: proxy.ts used to resolve
 *     these hosts to a longer URL slug of proxy.ts's own invention (spelled
 *     out in `./RENAME.md` §0) while Supabase called the project `abluo`, so
 *     one project carried three names — that URL segment, Supabase `abluo`,
 *     Sanity `abluo`. Flipping proxy.ts onto this module would have renamed the
 *     platform's own site to `/en/abluo` underneath it, and
 *     `resolveDefaultLocale('abluo')` returned null.
 *     Step 1 of `./RENAME.md` settled it the way this note asked — by renaming
 *     the URL segment to Supabase's `abluo` (safe: the segment is an internal
 *     rewrite target, never visible in a browser, and appears in no Sanity
 *     document). proxy.ts and this module now agree on `abluo.app` and
 *     `dev.abluo.app`, slug AND locale; `__tests__/host-scope.test.ts` guards
 *     that agreement.
 *     The only project-name gap left anywhere is Sanity's `livener` /
 *     `livener-main` (and `studiomartegani-main`) — divergence (D) below,
 *     Steps 3-5 of `./RENAME.md`.
 *
 * (B) `ch-psicoterapeuta.com` (project `hoffmann`) is a live `custom_domain` in
 *     Supabase and is in NONE of proxy.ts's three maps, so proxy.ts resolves it
 *     to null and serves it the platform routes. This module resolves it. That
 *     is a fix, not a regression — but it IS a behaviour change on a live host,
 *     so it belongs in the flip's test plan, not in its footnotes.
 *
 * (C) Unknown `*.preview.abluo.app` and `*.localhost` subdomains. proxy.ts
 *     GUESSES: it returns whatever the subdomain says, for any subdomain, and
 *     lets the route 404 later. This module returns null for a subdomain that
 *     is not a known project. Fail-closed is the house rule (`project-scope.ts`:
 *     "null MUST mean select nothing, never select everything"), and a guessed
 *     project slug at the edge is precisely how one tenant's host can be made
 *     to render another tenant's route.
 *
 * (D) Sanity `projectSlug`. This module returns `projects.slug` from Supabase
 *     (`livener`), NOT the Sanity `project.projectSlug` (`livener-main`). It
 *     deliberately does not carry a third field for the Sanity name: adding one
 *     would make this module the fourth copy of `TENANT_TO_PROJECT` instead of
 *     the thing that retires it. Callers that need Sanity's name keep using
 *     `TENANT_TO_PROJECT` until that split is reconciled.
 *
 * ── What this module does NOT do ─────────────────────────────────────────────
 *   - No path parsing. `preview.abluo.app/<slug>` and `dev.abluo.app/<slug>`
 *     are PATH-based routing and stay in proxy.ts; a host resolver that also
 *     read paths would re-create the collision D-2 rejects.
 *   - No network, no Supabase, no async. It must run in the edge runtime inside
 *     a request, so it is a pure synchronous lookup over a frozen table.
 *   - No locale negotiation. `defaultLocale` is the project's default; the
 *     cookie/Accept-Language negotiation in proxy.ts:395 is policy and stays
 *     where the request headers are.
 *   - No inactive projects. A row with `status !== 'active'` is present in the
 *     table but resolves to null — `t42` exists and must not serve.
 */

import { asSupabaseProjectSlug, asTenantSlug, type SupabaseProjectSlug, type TenantSlug } from './ids'
import {
  GENERATED_HOST_ROUTES,
  GENERATED_PLATFORM_HOSTS,
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
 * and a host whose project is not `active`. It NEVER guesses — there is no
 * subdomain-shaped fallback, no "strip the suffix and hope", no default project.
 *
 * `null` must be treated as "this host has no project", never as "use the
 * platform default". Callers that need to tell an unknown host from a platform
 * host should ask `isPlatformHost()`; both are `null` here on purpose, because
 * for ROUTING they are the same answer.
 */
export function resolveScopeFromHost(host: string | null | undefined): HostScope | null {
  const route = lookupHostRoute(host)
  if (!route) return null
  if (route.status !== 'active') return null
  return {
    tenantSlug: asTenantSlug(route.tenantSlug),
    projectSlug: asSupabaseProjectSlug(route.projectSlug),
    projectId: route.projectId,
    defaultLocale: route.defaultLocale,
  }
}

/**
 * The raw generated row for a host, `status` and `hostKind` included, ignoring
 * the active-only rule.
 *
 * For diagnostics, admin tooling and tests — an admin UI wants to say "t42 is
 * configured on t42.preview.abluo.app but is inactive", which
 * `resolveScopeFromHost` cannot express. NOT for routing: routing must go
 * through `resolveScopeFromHost` so the inactive check cannot be forgotten.
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

export type { GeneratedHostRoute }
