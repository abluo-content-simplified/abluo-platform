/**
 * Who may see a draft preview (ADR-025 · preview). Pure apart from the
 * injected draft read, so the whole decision is unit-tested.
 *
 * Everything must hold, otherwise the route answers 404 (never "forbidden" —
 * nothing about the draft's existence leaks):
 *   1. the id in the URL is a safe document id (uuid or readable migrated id);
 *   2. the token is genuine and unexpired (HMAC, ≤ 15 min);
 *   3. the token names THIS draft and THIS project (the URL's project segment);
 *   4. the request host may serve this project: a platform host (path-based —
 *      dev/preview/localhost/unknown deployment hosts) or one of this
 *      project's own hosts, never another site's domain;
 *   5. the draft exists (`drafts.<id>`), is a post, and belongs to the token's
 *      project. A published-only post has no draft, so it is not previewable.
 * The draft is only read once 1–4 pass.
 */
import { lookupHostRoute } from '@/lib/tenancy/host-scope'
import { verifyDraftPreviewToken, type DraftPreviewClaims } from '@/lib/preview/draft-preview-token'

/** Same safe-id rule as the dashboard write paths (isPostId / isGalleryId). */
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** True when `host` may render `projectSlug`'s pages. */
export function hostMayServeProject(host: string | null | undefined, projectSlug: string): boolean {
  const route = lookupHostRoute(host)
  if (!route) return true // platform / path-based host (localhost, preview.abluo.app, *.vercel.app)
  if (route.hostKind === 'platform-alias') return true // dev.abluo.app/<project>
  return route.projectSlug === projectSlug
}

export type DraftLite = { _type?: unknown; projectSlug?: unknown } | null | undefined

export async function authorizeDraftPreview(input: {
  token: unknown
  draftId: string
  urlProject: string
  host: string | null | undefined
  getDraft: (documentId: string) => Promise<DraftLite>
  secret?: Buffer | null
  now?: number
}): Promise<DraftPreviewClaims | null> {
  if (typeof input.draftId !== 'string' || !DOC_ID.test(input.draftId)) return null
  const claims = verifyDraftPreviewToken(input.token, { secret: input.secret, now: input.now })
  if (!claims || claims.kind !== 'post') return null
  if (claims.draftId !== input.draftId || claims.projectSlug !== input.urlProject) return null
  if (!hostMayServeProject(input.host, claims.projectSlug)) return null
  let draft: DraftLite
  try {
    draft = await input.getDraft(`drafts.${input.draftId}`)
  } catch {
    return null
  }
  if (!draft || draft._type !== 'post' || draft.projectSlug !== claims.projectSlug) return null
  return claims
}

/**
 * Gallery preview: the same rules, for a token of kind 'gallery'. The gallery
 * may be previewed from its draft or — when it has no unpublished changes —
 * its published version; either must be this project's gallery. When the
 * token names a page, that page must be this project's and actually show the
 * gallery (`pageShowsGallery`, one read).
 */
export async function authorizeGalleryPreview(input: {
  token: unknown
  galleryId: string
  urlProject: string
  host: string | null | undefined
  getDoc: (documentId: string) => Promise<DraftLite>
  pageShowsGallery: (pageId: string, galleryId: string, projectSlug: string) => Promise<boolean>
  secret?: Buffer | null
  now?: number
}): Promise<DraftPreviewClaims | null> {
  if (typeof input.galleryId !== 'string' || !DOC_ID.test(input.galleryId)) return null
  const claims = verifyDraftPreviewToken(input.token, { secret: input.secret, now: input.now })
  if (!claims || claims.kind !== 'gallery') return null
  if (claims.draftId !== input.galleryId || claims.projectSlug !== input.urlProject) return null
  if (claims.pageId !== null && !DOC_ID.test(claims.pageId)) return null
  if (!hostMayServeProject(input.host, claims.projectSlug)) return null
  try {
    const doc = (await input.getDoc(`drafts.${input.galleryId}`)) ?? (await input.getDoc(input.galleryId))
    if (!doc || doc._type !== 'gallery' || doc.projectSlug !== claims.projectSlug) return null
    if (claims.pageId && !(await input.pageShowsGallery(claims.pageId, input.galleryId, claims.projectSlug))) return null
  } catch {
    return null
  }
  return claims
}
