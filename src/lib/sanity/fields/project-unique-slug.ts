/**
 * Project-scoped slug uniqueness for `localizedSlug`.
 *
 * Sanity's built-in slug check is dataset-wide: it rejects a slug if ANY
 * document of the same type uses it — so the second tenant to name a page
 * "home" (or "about", "contact"…) got "Slug is already in use", even though
 * every route filters by projectSlug and the two never meet. Uniqueness is a
 * per-project rule: same type, same project, same language, other document.
 *
 * The document's own draft and published copies are excluded, so editing a
 * page never collides with itself.
 */

export const PROJECT_UNIQUE_SLUG_QUERY =
  '!defined(*[_type == $type && projectSlug == $projectSlug && !(_id in [$draftId, $publishedId]) && slug[$locale].current == $slug][0]._id)'

export interface UniqueSlugDoc {
  _id?: string
  _type?: string
  projectSlug?: string
}

export function projectUniqueSlugParams(slug: string, doc: UniqueSlugDoc, locale: string) {
  const publishedId = (doc._id ?? '').replace(/^drafts\./, '')
  return {
    type: doc._type ?? '',
    projectSlug: doc.projectSlug ?? null,
    draftId: `drafts.${publishedId}`,
    publishedId,
    locale,
    slug,
  }
}

type Fetcher = { fetch: (query: string, params: Record<string, unknown>) => Promise<unknown> }

/** Factory for the `options.isUnique` of one locale's slug field. */
export function isUniqueInProject(locale: string) {
  return async (
    slug: string,
    context: { document?: UniqueSlugDoc; getClient: (o: { apiVersion: string }) => Fetcher },
  ): Promise<boolean> => {
    const doc = context.document
    if (!doc?._id || !doc._type) return true
    const client = context.getClient({ apiVersion: '2026-05-21' })
    return Boolean(await client.fetch(PROJECT_UNIQUE_SLUG_QUERY, projectUniqueSlugParams(slug, doc, locale)))
  }
}
