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
 *      spreading the caller's params FIRST, then forcing `projectSlug` from
 *      the resolved grant LAST:
 *        `{ ...params, projectSlug: grant.projectSlug }`
 *      A caller-supplied `projectSlug` key is always overwritten, never
 *      merged or honored — it is structurally impossible to read another
 *      project's content by passing a different `projectSlug` param.
 *
 *   3. Every query must reference `$projectSlug` (a lightweight runtime
 *      guard — `assertQueryIsTenantScoped`). Raw string interpolation of
 *      tenant identity is banned at this chokepoint (ADR-015 R2): a query
 *      that doesn't parameterize on `$projectSlug`, or that looks like it
 *      inlines a tenant identifier via template-literal interpolation
 *      (`${...}`), is rejected before it ever reaches Sanity.
 *
 *   4. `assertSameTenantReference(scoped, referencedDocId, grant)` — the
 *      reference/media cross-tenant guard (ADR-015 R3) — independently
 *      re-fetches the referenced document's own `projectSlug` (via an
 *      internal, ungated raw fetch reserved for exactly this verification —
 *      see "Why the reference guard bypasses the $projectSlug query guard"
 *      below) and rejects if it does not match the grant's `projectSlug`.
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
 * ── Not wired into any route yet ────────────────────────────────────────────
 * Per the ADR-017 Implementation Order, this slice (3a) builds the
 * chokepoint and guard only. No route or component calls
 * `tenantScopedSanityClient` yet — it is inert, exactly like
 * `tenant-context.ts` was on landing. Route wiring is a later slice.
 *
 * Internally reuses the existing configured `sanityClient`
 * (`src/lib/sanity/client.ts`) — the raw, unscoped `@sanity/client` instance
 * is never exposed to callers of this module.
 */
import { sanityClient } from '@/lib/sanity/client'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'

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
  readonly projectSlug: string
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
 */
function assertQueryIsTenantScoped(query: string): void {
  if (query.includes('${')) {
    throw new TenantAuthorizationError(
      'tenantScopedSanityClient: query string contains a template-literal interpolation ' +
        '(`${...}`) — raw interpolation of tenant identity is banned at this chokepoint. ' +
        'Use a bound GROQ parameter ($projectSlug) instead.'
    )
  }
  if (!query.includes('$projectSlug')) {
    throw new TenantAuthorizationError(
      'tenantScopedSanityClient: query must reference $projectSlug — every query executed ' +
        'through this chokepoint must be scoped by the bound projectSlug parameter.'
    )
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

  const client: TenantScopedSanityClient = {
    projectId: grant.projectId,
    projectSlug: grant.projectSlug,
    fetch<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
      assertQueryIsTenantScoped(query)
      // Caller params spread FIRST, projectSlug forced from the resolved
      // grant LAST — a caller-supplied projectSlug key is always
      // overwritten, never merged or honored (ADR-017 Decision 4).
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

  const referencedProjectSlug = referenced?.projectSlug

  if (!referencedProjectSlug || referencedProjectSlug !== grant.projectSlug) {
    throw new TenantAuthorizationError(
      `assertSameTenantReference: referenced document "${referencedDocId}" belongs to project ` +
        `"${referencedProjectSlug ?? 'unknown'}", not the caller's granted project ` +
        `"${grant.projectSlug}" — cross-tenant reference rejected.`
    )
  }
}
