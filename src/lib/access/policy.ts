/**
 * Site Access — the ONE authorization decision for visitors (ADR-040 §4).
 * Pure: no I/O. Every page gate, file route and listing filter calls
 * `evaluateAccess()`; nothing else decides whether a visitor may open a
 * restricted resource.
 *
 * Semantics:
 *   - A resource is either public or restricted to a set of groups.
 *   - Within ONE resource the groups are OR'd: one matching group is enough.
 *   - Along a CHAIN (page → section → attached file, later) every restricted
 *     link must be satisfied: AND. A child can never be less restricted than
 *     its parent, because the parent is still in the chain.
 *   - Deny by default: restricted with no groups → nobody; an id that is not
 *     one of the visitor's LIVE groups (archived, another project's, made up)
 *     grants nothing; the module being off denies every restricted resource
 *     (it never makes them public).
 */
import { isUuid } from './model'

export type AccessPolicy =
  | { visibility: 'public' }
  | { visibility: 'restricted'; groupIds: readonly string[] }

/** What the visitor holds on THIS project, as resolved live from the database. */
export type VisitorGrants = {
  sessionId: string
  /** Live group ids of the request's project only (site_access_resolve). */
  groupIds: ReadonlySet<string>
}

export type AccessDecision =
  | { allowed: true; reason: 'public' | 'granted' }
  | { allowed: false; reason: 'module_unavailable' | 'no_session' | 'no_matching_group' | 'nobody' }

export const PUBLIC_POLICY: AccessPolicy = { visibility: 'public' }

/** Normalises a group list: unique, valid UUIDs only, stable order. */
export function normalizeGroupIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isUuid).map((id) => id.toLowerCase()))].sort()
}

/**
 * Reads the `access` object a Sanity document carries (`page.access`, B2.2).
 *
 *   absent / null                        → public (every existing page)
 *   { visibility: 'public', … }          → public
 *   { visibility: 'restricted', groups } → restricted to those groups
 *   anything else — a missing or unknown visibility, a wrong type → restricted
 *   to NOBODY
 *
 * Fail-closed on purpose: a malformed access object must never publish a page
 * that someone meant to restrict. The GROQ twin of this rule is
 * `pageIsOpen()` in ./groq.ts — the two MUST agree (a test pins them): public
 * iff `access` is absent or `access.visibility == "public"`.
 */
export function parseAccessPolicy(raw: unknown): AccessPolicy {
  if (raw === undefined || raw === null) return PUBLIC_POLICY
  if (typeof raw !== 'object' || Array.isArray(raw)) return { visibility: 'restricted', groupIds: [] }
  const r = raw as { visibility?: unknown; groups?: unknown }
  if (r.visibility === 'public') return PUBLIC_POLICY
  if (r.visibility === 'restricted') return { visibility: 'restricted', groupIds: normalizeGroupIds(r.groups) }
  return { visibility: 'restricted', groupIds: [] }
}

/** How a restricted page appears in navigation (`page.access.navigation`). Default: hidden. */
export type NavigationMode = 'hidden' | 'locked'
export function parseNavigationMode(raw: unknown): NavigationMode {
  if (raw && typeof raw === 'object' && (raw as { navigation?: unknown }).navigation === 'locked') return 'locked'
  return 'hidden'
}

/**
 * The PATH ancestors of a nested page slug, nearest last:
 * "members/teachers/notes" → ["members", "members/teachers"]. A page lives
 * under a parent page by its path (D1 nested routing), so a child can never be
 * less restricted than any page at a prefix of its path (AND along the chain).
 */
export function slugAncestorPaths(slug: string): string[] {
  const parts = slug.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function isRestricted(chain: readonly AccessPolicy[]): boolean {
  return chain.some((p) => p.visibility === 'restricted')
}

export function evaluateAccess(input: {
  chain: readonly AccessPolicy[]
  visitor: VisitorGrants | null
  /** The Access module is installed AND enabled for this project. */
  moduleEnabled: boolean
}): AccessDecision {
  const restricted = input.chain.filter(
    (p): p is Extract<AccessPolicy, { visibility: 'restricted' }> => p.visibility === 'restricted'
  )
  if (restricted.length === 0) return { allowed: true, reason: 'public' }
  if (!input.moduleEnabled) return { allowed: false, reason: 'module_unavailable' }
  if (restricted.some((p) => p.groupIds.length === 0)) return { allowed: false, reason: 'nobody' }
  if (!input.visitor) return { allowed: false, reason: 'no_session' }
  const held = input.visitor.groupIds
  const everyLinkSatisfied = restricted.every((p) => p.groupIds.some((g) => held.has(g.toLowerCase())))
  return everyLinkSatisfied ? { allowed: true, reason: 'granted' } : { allowed: false, reason: 'no_matching_group' }
}

/**
 * Every group that helps open some restricted link of the chain — used to
 * narrow which passwords a prompt checks (a password none of whose groups
 * appears here cannot help, so it is not tried). A UNION, not an
 * intersection: with AND across links a visitor may satisfy different links
 * with different passwords. `null` = nothing restricted.
 */
export function groupsRelevantTo(chain: readonly AccessPolicy[]): string[] | null {
  let acc: Set<string> | null = null
  for (const p of chain) {
    if (p.visibility !== 'restricted') continue
    acc ??= new Set<string>()
    for (const g of p.groupIds) acc.add(g.toLowerCase())
  }
  return acc === null ? null : [...acc].sort()
}
