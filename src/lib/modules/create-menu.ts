/**
 * "What would you like to create?" — the Add-content sheet (ADR-025 D8).
 *
 * Pure projection of a ProjectGrant onto the content types a client can create.
 * Configuration lives here, next to MODULE_DASHBOARD_ROUTES, not in a component:
 *   • `ready` types have a working wizard (Blog today); the rest of the content
 *     modules show as "Coming soon" when installed.
 *   • A type is offered only when its module is installed and the user's role
 *     can write it (viewers get nothing to create).
 *   • Owners also see "More you can add" — content modules NOT installed — as a
 *     soft upsell. Editors and viewers never do.
 */
import type { ProjectGrant } from '@/lib/api/tenant-context'

export type CreateContentType = {
  moduleId: string
  /** True when the guided wizard exists for this type. */
  ready: boolean
  /** Permission needed to create it. */
  permission: string
}

export const CREATE_CONTENT_TYPES: CreateContentType[] = [
  { moduleId: 'blog', ready: true, permission: 'blog.post.write' },
  { moduleId: 'news', ready: false, permission: 'news.article.write' },
  { moduleId: 'events', ready: false, permission: 'events.event.write' },
  { moduleId: 'gallery', ready: true, permission: 'gallery.gallery.write' },
]

export type CreateMenu = {
  /** Installed types the user may create, in display order. */
  available: { moduleId: string; ready: boolean }[]
  /** Not-installed content modules (owners only). */
  more: string[]
}

export function buildCreateMenu(
  grant: Pick<ProjectGrant, 'role' | 'permissions' | 'enabledModuleIds'>,
  types: CreateContentType[] = CREATE_CONTENT_TYPES
): CreateMenu {
  const installed = new Set(grant.enabledModuleIds)
  const canWrite = (t: CreateContentType) => grant.permissions.includes(t.permission)
  return {
    available: types
      .filter((t) => installed.has(t.moduleId) && canWrite(t))
      .map((t) => ({ moduleId: t.moduleId, ready: t.ready })),
    more: grant.role === 'owner' ? types.filter((t) => !installed.has(t.moduleId)).map((t) => t.moduleId) : [],
  }
}
