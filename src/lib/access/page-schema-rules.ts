/**
 * Site Access — the Studio rules for `page.access` (ADR-040 §7). Pure, so the
 * schema's validation and the tests run the same code.
 *
 *   - The home page is always public: the field is hidden there and a stored
 *     `restricted` value on a home page is a validation error. The same holds
 *     for legal pages (cookie policy, legal notice, privacy): the law requires
 *     them to be public (R9, ADR-040 §15).
 *   - A restricted page needs at least one group, each a group id (UUID). The
 *     groups are managed from the dashboard (B2.5); until then they are set by
 *     an Abluo admin.
 *   - A restricted page may not carry a "Download a file" CTA: Sanity files are
 *     served from the public asset CDN, so the file would be public whatever
 *     the page says. Protected files are Documents placed on the page through
 *     its Download section (R9).
 */
export const ACCESS_GROUP_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PageAccessValue = {
  visibility?: unknown
  groups?: unknown
  navigation?: unknown
} | null | undefined

/** Paths (for the error message) of every fileDownload CTA under `value`. */
export function findFileDownloadCtas(value: unknown, path = 'sections', out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findFileDownloadCtas(v, `${path}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (o.actionType === 'fileDownload') out.push(path)
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_') && k !== '_type') continue
      if (v && typeof v === 'object') findFileDownloadCtas(v, `${path}.${k}`, out)
    }
  }
  return out
}

export function validatePageAccess(
  access: PageAccessValue,
  doc: { pageType?: unknown; sections?: unknown } | undefined,
): true | string {
  if (!access || access.visibility === undefined || access.visibility === 'public') return true
  if (access.visibility !== 'restricted') return 'Choose who can see this page: everyone or members only.'
  if (doc?.pageType === 'home') return 'The home page is always public. Restrict another page instead.'
  if (doc?.pageType === 'legal') return 'Legal pages (cookie policy, legal notice, privacy) must stay public.'
  const groups = Array.isArray(access.groups) ? access.groups : []
  if (groups.length === 0) return 'A members-only page needs at least one access group.'
  if (!groups.every((g) => typeof g === 'string' && ACCESS_GROUP_ID_RE.test(g)))
    return 'Each access group must be a group id from the dashboard.'
  if (access.navigation !== undefined && access.navigation !== 'hidden' && access.navigation !== 'locked')
    return 'Navigation must be "hidden" or "show with a lock".'
  const downloads = findFileDownloadCtas(doc?.sections)
  if (downloads.length > 0)
    return 'A members-only page cannot have a "Download a file" button: files uploaded here are public by link. Add a Download section and place the file there as a document (dashboard → Documents), or remove the button.'
  return true
}

/**
 * `site-access` is the website path of the Access routes (sign-in, sign-out,
 * protected documents). A page slug there would be unreachable — refuse it in
 * Studio rather than silently shadowing a page. (Checked against production
 * on 2026-10-24: no page used it.)
 */
export const ACCESS_ROUTE_SLUG = 'site-access'

export function validatePageSlugNotReserved(slug: unknown): true | string {
  if (!slug || typeof slug !== 'object') return true
  for (const v of Object.values(slug as Record<string, unknown>)) {
    const current = (v as { current?: unknown } | null)?.current
    if (typeof current !== 'string') continue
    const first = current.trim().replace(/^\/+/, '').split('/')[0].toLowerCase()
    if (first === ACCESS_ROUTE_SLUG) return `"${ACCESS_ROUTE_SLUG}" is reserved for the members sign-in and protected documents. Choose another URL.`
  }
  return true
}

