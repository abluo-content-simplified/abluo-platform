/**
 * Content lifecycle — the public-visibility rule (ADR-032 D3).
 *
 * One rule decides whether an editorial document may reach the public:
 *
 *   <publishedAt rule> && (!defined(expiresAt) || expiresAt > now()) && !defined(archivedAt)
 *
 * It must be used by EVERY public delivery path (lists, detail routes, sitemap,
 * hreflang, metadata, related blocks, dereferenced references, partner API…).
 * `isPublicFilter` builds the GROQ fragment; `isPublicAt` is the same rule in
 * TypeScript (partner-sync boundaries, dashboard status). A test proves the two
 * agree on every fixture.
 *
 * `publishedAtRule`:
 *   - 'required' — posts (unchanged): no publishedAt = never public.
 *   - 'optional' — types adopting the lifecycle later (events, galleries, menus):
 *     no publishedAt = public, so existing documents stay live with no migration.
 */

export type PublishedAtRule = 'required' | 'optional'

/** The lifecycle fields every lifecycle type carries (all optional, UTC ISO strings). */
export type LifecycleFields = {
  publishedAt?: string | null
  expiresAt?: string | null
  archivedAt?: string | null
}

const PATH = /^$|^[A-Za-z_][A-Za-z0-9_]*(->|\.)$|^@->$/

/**
 * GROQ boolean expression: true when the document is public right now.
 *
 * @param rule   see PublishedAtRule
 * @param path   optional accessor prefix for a dereferenced or nested document,
 *               e.g. `'relatedEvent->'` or `'@->'` (inside `[]` filters). Empty
 *               for the document itself.
 */
export function isPublicFilter(rule: PublishedAtRule, path = ''): string {
  if (!PATH.test(path)) throw new Error(`isPublicFilter: unsupported path "${path}"`)
  const f = (name: string) => `${path}${name}`
  const published =
    rule === 'required'
      ? `defined(${f('publishedAt')}) && ${f('publishedAt')} <= now()`
      : `(!defined(${f('publishedAt')}) || ${f('publishedAt')} <= now())`
  return `(${published} && (!defined(${f('expiresAt')}) || ${f('expiresAt')} > now()) && !defined(${f('archivedAt')}))`
}

/** Epoch ms of an ISO date-time, or null when absent or not a date. */
export function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/** The rule of `isPublicFilter`, evaluated in TypeScript at `now`. */
export function isPublicAt(doc: LifecycleFields | null | undefined, rule: PublishedAtRule, now: Date): boolean {
  if (!doc) return false
  const t = now.getTime()
  if (doc.archivedAt != null) return false
  const publishedAt = instant(doc.publishedAt)
  const expiresAt = instant(doc.expiresAt)
  if (rule === 'required' ? publishedAt === null || publishedAt > t : publishedAt !== null && publishedAt > t) return false
  if (expiresAt !== null && expiresAt <= t) return false
  return true
}
