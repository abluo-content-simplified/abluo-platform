/**
 * The draft-preview URL the dashboard loads in its frame (and "Open in a new
 * tab"). Path-based on purpose: `/{locale}/{project}/preview/post/{id}` is the
 * route on every host the proxy serves, platform or the project's own domain.
 */
export function draftPreviewUrl(p: {
  origin: string
  locale: string
  projectSlug: string
  id: string
  token: string
  theme?: 'light' | 'dark' | null
  /** 'gallery' → `/preview/gallery/{id}` (gallery drafts); default 'post'. */
  kind?: 'post' | 'gallery' | 'person'
}): string {
  const q = new URLSearchParams({ t: p.token })
  if (p.theme) q.set('theme', p.theme)
  const seg = (s: string) => encodeURIComponent(s)
  return `${p.origin}/${seg(p.locale)}/${seg(p.projectSlug)}/preview/${p.kind === 'gallery' ? 'gallery' : p.kind === 'person' ? 'person' : 'post'}/${seg(p.id)}?${q.toString()}`
}

/**
 * People: the private preview of a person's profile page (draft, else published).
 * Mint the token with `mintPersonPreviewAction` (`people/preview-action.ts`),
 * then open this URL in a new tab / frame. `locale` = the language to preview.
 */
export function personPreviewUrl(p: {
  origin: string
  locale: string
  projectSlug: string
  /** The person's Sanity base id (no `drafts.` prefix). */
  id: string
  token: string
  theme?: 'light' | 'dark' | null
}): string {
  return draftPreviewUrl({ ...p, kind: 'person' })
}
