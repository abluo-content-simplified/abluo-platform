/**
 * Who may see a draft preview (ADR-025 · preview). Pure apart from the
 * injected draft read, so the whole decision is unit-tested.
 *
 * Everything must hold, otherwise the route answers 404 (never "forbidden" —
 * nothing about the draft's existence leaks):
 *   1. the id in the URL is a draft uuid;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
  if (typeof input.draftId !== 'string' || !UUID.test(input.draftId)) return null
  const claims = verifyDraftPreviewToken(input.token, { secret: input.secret, now: input.now })
  if (!claims) return null
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
