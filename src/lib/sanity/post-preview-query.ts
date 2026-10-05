/**
 * The draft-preview query: postBySlugQuery's PROJECTION, unchanged, over one
 * draft document instead of the live, slug-addressed post.
 *
 * Derived at module load rather than copied, so every field the live post
 * page reads (cover + focal point, links, categories, CTA, gallery, …) is in
 * the preview the moment it is added to postBySlugQuery — the two can never
 * drift. Only the filter differs:
 *   live:    projectSlug + slug in this language + published and not expired
 *   preview: projectSlug + `_id == $draftId` (`drafts.<uuid>`, run with
 *            perspective "raw", so it reads the draft itself)
 */
import { postBySlugQuery } from '@/lib/sanity/queries'

const SPLIT = '][0]'

function deriveDraftQuery(live: string): string {
  const at = live.indexOf(SPLIT)
  if (at < 0 || !live.trimStart().startsWith('*[_type == "post"')) {
    throw new Error('postBySlugQuery changed shape — update post-preview-query.ts')
  }
  return `*[_type == "post" && projectSlug == $projectSlug && _id == $draftId${live.slice(at)}`
}

export const postDraftPreviewQuery = /* groq */ deriveDraftQuery(postBySlugQuery)

/** Exposed for the drift test. */
export const __derive = deriveDraftQuery
