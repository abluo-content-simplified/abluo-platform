/**
 * Tenant-scoped Sanity chokepoint — ADR-017 slice 3a.
 *
 * Implements ADR-017 Decision 4 (`tenantScopedSanityClient(ctx, projectId)`,
 * specializing ADR-015 R2) and the reference/media recursion guard (ADR-015
 * R3, shared infrastructure at this same chokepoint).
 *
 * ── What this file makes structurally impossible ────────────────────────────
 * A caller holding a `TenantAuthorizationContext` cannot read or (once write
 * sites adopt the reference guard) write another project's Sanity content
 * through this module, because:
 *
 *   1. `tenantScopedSanityClient(ctx, projectId)` looks up the `ProjectGrant`
 *      for `projectId` in `ctx.projects` and REJECTS (throws
 *      `TenantAuthorizationError`) if no grant exists — it never falls back
 *      to an unscoped client or substitutes a different project. There is no
 *      way to obtain a scoped client for a project you have no grant in.
 *
 *   2. Every `fetch()` call through the returned client builds its params by
 *      spreading the caller's params FIRST, then forcing the scope from the
 *      resolved grant LAST:
 *        `{ ...params, projectSlug: grant.projectSlug }`
 *      A caller-supplied `projectSlug` key is always overwritten, never merged
 *      or honored — it is structurally impossible to read another project's
 *      content by passing a different param.
 *
 *      The grant's `projectSlug` is the project's ONE name: `projects.slug` in
 *      Supabase and the `projectSlug` field on its Sanity documents now hold
 *      the same string (`src/lib/tenancy/RENAME.md` Step 4). Binding it
 *      directly is what makes the client dashboard's Posts list non-empty for
 *      Livener and Studio Martegani; the Step 3 dual-read that bridged the two
 *      names in the meantime was removed by Step 5.
 *
 *   3. Every query must reference `$projectSlug` (a lightweight runtime
 *      guard — `assertQueryIsTenantScoped`, over the shared detector
 *      `findTenantScopeViolation` in `@/lib/sanity/client`). Raw string
 *      interpolation of tenant identity is banned at this chokepoint
 *      (ADR-015 R2): a query that doesn't parameterize on `$projectSlug`, or
 *      that looks like it inlines a tenant identifier via template-literal
 *      interpolation (`${...}`), is rejected before it ever reaches Sanity.
 *
 *   4. `assertSameTenantReference(scoped, referencedDocId, grant)` — the
 *      reference/media cross-tenant guard (ADR-015 R3) — independently
 *      re-fetches the referenced document's own `projectSlug` (via an
 *      internal, ungated raw fetch reserved for exactly this verification —
 *      see "Why the reference guard bypasses the $projectSlug query guard"
 *      below) and rejects unless it equals the grant's own `projectSlug` —
 *      one name compared against one name.
 *      This is a shared helper meant to be called at every future write site
 *      that accepts a reference or media asset — not reimplemented per
 *      route. It is not wired into any route in this slice.
 *
 * ── Why the reference guard bypasses the $projectSlug query guard ──────────
 * The reference guard's entire job is to discover the TRUE `projectSlug` of
 * an arbitrary referenced document, independent of what the caller expects
 * or what project the caller is scoped to — a query like
 * `*[_id == $referencedDocId][0]{ projectSlug }` deliberately does not (and
 * must not) filter by `$projectSlug`, or it would always "confirm" whatever
 * project the caller already believes it belongs to, defeating the check.
 * This is the one legitimate exception to the "every query references
 * $projectSlug" rule, and it is not exposed on the public
 * `TenantScopedSanityClient` shape — it is reachable only through
 * `assertSameTenantReference`, via a module-private `WeakMap` keyed by the
 * client instance, so ordinary callers of `.fetch()` can never opt out of
 * the guard.
 *
 * ── Where this is wired (was stale: it said "no route yet") ─────────────────
 * `tenantScopedSanityClient` is live on the client-dashboard read path —
 * `src/lib/api/client-dashboard.ts` obtains a scoped client per request and
 * every dashboard Sanity read goes through it. It is no longer inert.
 *
 * The `assertSameTenantReference` write-side guard (point 4 above) is still
 * unwired: there is no write route that accepts a reference or media asset
 * yet. That helper — and only that helper — remains a primitive awaiting its
 * first caller.
 *
 * ── The website read path uses the same rule, a different reaction ──────────
 * Finding I-9: the public website does NOT use this chokepoint (it has no
 * `TenantAuthorizationContext` — there is no logged-in actor). It reads
 * through `tenantClient(tenantSlug).fetchForTenant` in
 * `src/lib/sanity/client.ts`, which injects `projectSlug`/`tenantSlug` as
 * bound params. Injection alone proved nothing: a query that never mentions
 * `$projectSlug` was handed the parameter and ignored it, returning every
 * tenant's documents — scoping there was a convention, not a control.
 *
 * `fetchForTenant` now runs the SAME detector, so the rule cannot drift
 * between the two paths. The reaction differs on purpose: this chokepoint
 * always throws (a failing API route is contained), whereas the website
 * throws only in development and logs a `console.error` carrying the query
 * and both slugs in production, where a false positive from a substring
 * check would take a live client site down. See `tenantScopeEnforcement` in
 * `@/lib/sanity/client` for that trade-off in full, and
 * `UNSCOPED_READ_EXEMPTIONS` there for the website's one audited exemption
 * (`fetchDesignSystemById`, which follows `parentDesignSystem->` across
 * projects by design).
 *
 * Internally reuses the existing configured `sanityClient`
 * (`src/lib/sanity/client.ts`) — the raw, unscoped `@sanity/client` instance
 * is never exposed to callers of this module.
 */
import { findTenantScopeViolation, sanityClient } from '@/lib/sanity/client'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { toProjectSlug, type ProjectSlug } from '@/lib/tenancy/ids'

// ── Error type ──────────────────────────────────────────────────────────────

/**
 * Thrown by this chokepoint whenever an access is rejected — never used for
 * "soft" signaling. Callers must handle rejection explicitly; there is no
 * fallback value to silently substitute.
 */
export class TenantAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantAuthorizationError'
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * The minimal fetch shape this module depends on. Matches
 * `@sanity/client`'s `.fetch<T>(query, params)` signature closely enough to
 * be satisfied by `sanityClient.fetch` directly, and is also the injection
 * point tests use to avoid hitting live Sanity.
 */
export type SanityFetchFn = <T>(query: string, params?: Record<string, unknown>) => Promise<T>

export type TenantScopedSanityClient = {
  readonly projectId: string
  /**
   * The granted project's name — `projects.slug`, exactly as
   * `tenant-context.ts` read it off the row, and (since `RENAME.md` Step 4)
   * also the value its Sanity documents carry in their own `projectSlug`
   * field. One name, one namespace; this is what is bound to `$projectSlug`.
   */
  readonly projectSlug: ProjectSlug
  /**
   * Runs a parameterized GROQ query scoped to this client's granted project.
   * `projectSlug` in `params` (if supplied) is always overwritten by the
   * resolved grant's value — see module header, point 2. `query` MUST
   * reference `$projectSlug`; queries that don't are rejected before
   * reaching Sanity.
   */
  fetch<T>(query: string, params?: Record<string, unknown>): Promise<T>
}

// ── Runtime query guard ─────────────────────────────────────────────────────

/**
 * Rejects queries that don't parameterize on `$projectSlug`, and rejects the
 * template-literal interpolation pattern (`${...}`) as a defense-in-depth
 * signal that tenant identity may have been inlined as a literal rather than
 * passed as a bound GROQ parameter. This is a lightweight guard, not a full
 * GROQ parser — it does not attempt to prove the query is otherwise correct.
 *
 * The detection itself now lives in `findTenantScopeViolation`
 * (`@/lib/sanity/client`) so the public-website read path
 * (`tenantClient().fetchForTenant`) enforces the SAME rule rather than a
 * second, drifting copy of it. Only the REACTION differs, and it differs
 * deliberately: this chokepoint always throws — an API route failing is a
 * contained failure — while the website throws in development and warns in
 * production, where a false positive would black out a live client site.
 * Behaviour here, including the exact error messages, is unchanged.
 */
function assertQueryIsTenantScoped(query: string): void {
  const violation = findTenantScopeViolation(query, 'tenantScopedSanityClient')
  if (violation) {
    throw new TenantAuthorizationError(violation.message)
  }
}

// ── Chokepoint factory ──────────────────────────────────────────────────────

/**
 * Module-private map from a scoped client instance to its underlying raw
 * fetch. Deliberately not exposed on `TenantScopedSanityClient` — the only
 * consumer is `assertSameTenantReference` below, which needs to issue an
 * unscoped-by-projectSlug lookup to independently verify a referenced
 * document's true project (see module header).
 */
const rawFetchByClient = new WeakMap<TenantScopedSanityClient, SanityFetchFn>()

/**
 * Resolves a `TenantScopedSanityClient` for `projectId` from `ctx`.
 *
 * Rejects (throws `TenantAuthorizationError`) if `ctx` holds no
 * `ProjectGrant` for `projectId` — never substitutes another project or
 * falls back to an unscoped client. This is the core invariant of ADR-017
 * Decision 4: you can only obtain a scoped client for a project you are
 * actually granted on.
 *
 * `deps.fetch` is an injection point for tests — defaults to the real
 * `sanityClient.fetch`.
 */
export function tenantScopedSanityClient(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: { fetch?: SanityFetchFn } = {}
): TenantScopedSanityClient {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) {
    throw new TenantAuthorizationError(
      `tenantScopedSanityClient: no ProjectGrant for project "${projectId}" in this ` +
        `TenantAuthorizationContext (userId=${ctx.userId}) — access rejected. A scoped client ` +
        'can only be obtained for a project the caller is explicitly granted on.'
    )
  }

  const rawFetch: SanityFetchFn =
    deps.fetch ??
    (<T>(query: string, params?: Record<string, unknown>) =>
      sanityClient.fetch<T>(query, params ?? {}))

  // ── The Posts-list defect (finding (a) of `f669ab9`), now structural ──────
  //
  // `grant.projectSlug` is `projects.slug`, read straight off the Supabase
  // `projects` table. Sanity documents carry their own `projectSlug` field, and
  // for two live projects the two used to DISAGREE — the grant said `livener`,
  // every document said `livener-main` — so binding the grant's value to a
  // `projectSlug == $projectSlug` filter matched NOTHING and the client
  // dashboard's Posts list rendered EMPTY for Livener and Studio Martegani
  // (`client-dashboard.ts` -> `[tenant]/posts/page.tsx`). It was masked for
  // abluo/nologo/hoffmann/amelie, whose two names always coincided.
  //
  // `RENAME.md` Step 4 renamed the 39 documents, so the two names now coincide
  // for every project and the grant's value is simply the right one to bind.
  // The Step 3 dual-read that carried the dashboard across the rename is gone
  // with Step 5. There is no cast here and no Supabase->Sanity conversion —
  // there is nothing left to convert.
  const client: TenantScopedSanityClient = {
    projectId: grant.projectId,
    projectSlug: grant.projectSlug,
    fetch<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
      assertQueryIsTenantScoped(query)
      // Caller params spread FIRST, the scope forced from the resolved grant
      // LAST — a caller-supplied projectSlug key is always overwritten, never
      // merged or honored (ADR-017 Decision 4).
      const scopedParams = { ...params, projectSlug: grant.projectSlug }
      return rawFetch<T>(query, scopedParams)
    },
  }

  rawFetchByClient.set(client, rawFetch)
  return client
}

// ── Reference / media cross-tenant guard (ADR-015 R3) ───────────────────────

/**
 * Reusable guard for any future write that sets a reference or attaches
 * media: independently re-fetches the referenced document's own
 * `projectSlug` and rejects if it does not match `grant.projectSlug`.
 *
 * `grant` is taken explicitly (rather than trusting `scoped.projectSlug`
 * alone) so the check is independent of how the caller constructed the
 * scoped client — matching ADR-015 R3's "independently re-fetches ... and
 * rejects" wording.
 *
 * Not wired into any write route in this slice — this is the shared
 * primitive future write sites call; it must not be reimplemented per
 * route.
 */
export async function assertSameTenantReference(
  scoped: TenantScopedSanityClient,
  referencedDocId: string,
  grant: ProjectGrant
): Promise<void> {
  const rawFetch = rawFetchByClient.get(scoped)
  if (!rawFetch) {
    throw new TenantAuthorizationError(
      'assertSameTenantReference: the provided client was not produced by ' +
        'tenantScopedSanityClient() — refusing to verify a reference against an ' +
        'unrecognized client instance.'
    )
  }

  // Deliberately NOT scoped by $projectSlug — see module header, "Why the
  // reference guard bypasses the $projectSlug query guard".
  const referenced = await rawFetch<{ projectSlug?: string } | null>(
    `*[_id == $referencedDocId][0]{ projectSlug }`,
    { referencedDocId }
  )

  // Trust boundary: this came out of a Sanity document's own `projectSlug`.
  const referencedProjectSlug = toProjectSlug(referenced?.projectSlug)

  // ── Compare like with like (finding (b) of `f669ab9`) ─────────────────────
  //
  // This used to compare `referencedProjectSlug` (a SANITY slug, read off the
  // document above) against `grant.projectSlug` (a SUPABASE slug) with an
  // `as unknown as` in between. `'livener-main' !== 'livener'`, so once this
  // guard was wired into its first write route it would have rejected EVERY
  // legitimate reference — fail-closed, so never a leak, but a total outage of
  // whatever called it. It has zero callers today, which is exactly what made
  // it a landmine for whoever wires it first.
  //
  // It is now a plain equality between two values of ONE namespace, which is
  // what `RENAME.md` Step 4 made possible and what Step 5 contracted the Step 3
  // dual-read set down to. The guard is NOT weakened: a document belonging to
  // any other project — including a SIBLING PROJECT OF THE SAME TENANT, the
  // case a `-main` suffix-strip "fix" would have let through — is still
  // rejected; see `__tests__/tenant-scoped-sanity-guard.test.ts`.
  //
  // The grant is still read EXPLICITLY (never re-derived from `scoped`), which
  // is this function's stated invariant.
  if (!referencedProjectSlug || referencedProjectSlug !== grant.projectSlug) {
    throw new TenantAuthorizationError(
      `assertSameTenantReference: referenced document "${referencedDocId}" belongs to project ` +
        `"${referencedProjectSlug ?? 'unknown'}", not the caller's granted project ` +
        `"${grant.projectSlug}" — cross-tenant reference rejected.`
    )
  }
}
