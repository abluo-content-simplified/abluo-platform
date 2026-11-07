/**
 * Private draft preview paths (ADR-025 · preview) — shared by the proxy (which
 * marks the responses) and the website layout (which reads the marker).
 *
 * `/{locale}/{project}/preview/post/{id}` (and `/preview/gallery/{id}`) on platform hosts, `/{locale}/preview/post/{id}`
 * or `/preview/post/{id}` on a project's own domain (the proxy rewrites those
 * to the first form).
 */
export const DRAFT_PREVIEW_HEADER = 'x-abluo-draft-preview'

export function isDraftPreviewPath(pathname: string): boolean {
  return /\/preview\/(post|gallery|person|course)\/[^/]+\/?$/.test(pathname)
}

/**
 * Private reservation links (ADR-044 D11): `/{locale}/booking/{token}` and
 * `/{locale}/my-pass/{token}` — on a platform host with the project segment
 * (`/{locale}/{project}/booking/{token}`), on a project's own domain without.
 * The URL IS the credential, so the proxy marks these responses exactly like a
 * draft preview: never indexed, never cached, no Referer, and the website
 * layout loads no analytics / first-touch recorder / consent banner on them.
 * The token shape is the one links.ts mints (16-128 URL-safe characters).
 */
export function isPrivateLinkPath(pathname: string): boolean {
  return /^(?:\/[a-z]{2})?(?:\/[a-z0-9-]+)?\/(?:booking|my-pass)\/[A-Za-z0-9_-]{16,128}\/?$/.test(pathname)
}
