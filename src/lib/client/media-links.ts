/**
 * Where the Media screen's links go — injected by the page that shows the
 * screen, so the same screen serves the client dashboard (`/{project}/…`) and
 * the admin (`/media…`). Templates are plain strings (they cross the server →
 * client component boundary): `{project}` is the photo's project slug, `{id}`
 * the linked document's id. A null template = no link (plain text, or for
 * `add` no "Add photos" button). Pure, so it is unit-tested.
 */
import type { MediaUsage } from '@/lib/api/media-library'

export type MediaLinks = {
  /** "Add photos" — the media wizard of one project. */
  add: string | null
  /** "Used in" — one gallery, the posts list, one page. */
  gallery: string | null
  post: string | null
  page: string | null
}

/** The client dashboard's links (unchanged from before they were injected). */
export const CLIENT_MEDIA_LINKS: MediaLinks = {
  add: '/{project}/media/add',
  gallery: '/{project}/galleries/{id}',
  post: '/{project}/posts',
  page: null,
}

/** The admin's links: the admin media wizard; "Used in" stays text (the admin has no gallery or post screens). */
export const ADMIN_MEDIA_LINKS: MediaLinks = {
  add: '/media/add?project={project}',
  gallery: null,
  post: null,
  page: null,
}

/** Fills a template; null when there is no template or no project to fill it with. */
export function fillMediaLink(template: string | null | undefined, vars: { project: string | null; id?: string }): string | null {
  if (!template || !vars.project) return null
  if (template.includes('{id}') && !vars.id) return null
  return template.replaceAll('{project}', encodeURIComponent(vars.project)).replaceAll('{id}', encodeURIComponent(vars.id ?? ''))
}

/** The "Used in" link of one usage, or null for plain text. */
export function mediaUsageHref(links: MediaLinks, project: string | null, usage: Pick<MediaUsage, 'kind' | 'id'>): string | null {
  return fillMediaLink(links[usage.kind], { project, id: usage.id })
}

/** The admin Media page for one project, or for every project (null). */
export function adminMediaHref(project: string | null): string {
  return project ? `/media?project=${encodeURIComponent(project)}` : '/media'
}
