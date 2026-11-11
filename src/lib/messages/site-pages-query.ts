/** A project's published pages for the Messages link chooser (ADR-050 D4); `$projectSlug` is bound by fetchForTenant. */
export const SITE_PAGES_QUERY = /* groq */ `
  *[_type == "page" && projectSlug == $projectSlug && !(_id in path("drafts.**"))] | order(pageType == "home" desc, coalesce(title[$locale], title.it, title.en) asc)[0...200]{ pageType, title, slug }
`
