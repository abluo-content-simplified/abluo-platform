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
}): string {
  const q = new URLSearchParams({ t: p.token })
  if (p.theme) q.set('theme', p.theme)
  const seg = (s: string) => encodeURIComponent(s)
  return `${p.origin}/${seg(p.locale)}/${seg(p.projectSlug)}/preview/post/${seg(p.id)}?${q.toString()}`
}
