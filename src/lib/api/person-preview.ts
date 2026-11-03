/**
 * Mints the private preview link of a person's profile page (People module).
 * Mirrors `post-preview.ts` (ADR-025 · preview); the page it opens is
 * `(website)/[tenant]/preview/person/[id]`, rendered from the person's draft
 * (else its published version) in the site's real design.
 *
 * Gate, in order:
 *   1. `assertModuleAction(ctx, projectId, 'people.person.read')` — module
 *      installed + role grants read (viewers may preview, as they may read).
 *   2. The person is re-read: a `person` of the GRANT's project, never
 *      anonymised, else "not_found" (another project's person and a missing
 *      one look the same).
 *   3. A token of kind 'person' binding person + project + user, 15 minutes.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { isPersonId } from '@/lib/api/persons-lifecycle'
import { previewOrigin, sitePreviewThemes, PostPreviewError, type DraftPreviewLink, type PostPreviewDeps } from '@/lib/api/post-preview'
import { PEOPLE_PERMISSIONS } from '@/lib/modules/people/model'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { previewSecret, signDraftPreviewToken } from '@/lib/preview/draft-preview-token'

type PersonLite = { _type?: string; projectSlug?: string; anonymisedAt?: unknown } | null | undefined

export async function mintPersonPreview(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; host?: string | null; proto?: 'https' | 'http' },
  deps: PostPreviewDeps = {},
): Promise<DraftPreviewLink> {
  assertModuleAction(ctx, projectId, PEOPLE_PERMISSIONS.read)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const client = deps.client ?? sanityWriteClient

  if (!isPersonId(input?.id)) throw new PostPreviewError('not_found', 'Unknown person.')
  const secret = deps.secret === undefined ? previewSecret() : deps.secret
  if (!secret) throw new PostPreviewError('unavailable', 'Preview is not configured.')

  const doc = ((await client.getDocument(`drafts.${input.id}`)) ?? (await client.getDocument(input.id))) as PersonLite
  if (!doc || doc._type !== 'person' || doc.projectSlug !== grant.projectSlug || doc.anonymisedAt) {
    throw new PostPreviewError('not_found', 'Unknown person.')
  }

  const themes = await sitePreviewThemes(client, grant.projectSlug)
  const { token, exp } = signDraftPreviewToken(
    { kind: 'person', draftId: input.id, projectSlug: grant.projectSlug, userId: ctx.userId },
    { secret, now: deps.now },
  )
  return {
    token,
    exp,
    origin: previewOrigin(input.host, { projectId: grant.projectId, projectSlug: grant.projectSlug }, input.proto),
    projectSlug: grant.projectSlug,
    themes,
  }
}
