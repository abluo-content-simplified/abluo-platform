/**
 * Private draft preview paths (ADR-025 · preview) — shared by the proxy (which
 * marks the responses) and the website layout (which reads the marker).
 *
 * `/{locale}/{project}/preview/post/{id}` on platform hosts, `/{locale}/preview/post/{id}`
 * or `/preview/post/{id}` on a project's own domain (the proxy rewrites those
 * to the first form).
 */
export const DRAFT_PREVIEW_HEADER = 'x-abluo-draft-preview'

export function isDraftPreviewPath(pathname: string): boolean {
  return /\/preview\/post\/[^/]+\/?$/.test(pathname)
}
