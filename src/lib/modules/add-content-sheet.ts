/**
 * "What would you like to create?" — the Add-content sheet (ADR-025 D8).
 *
 * Pure projection of a ProjectGrant onto the content types a client can create.
 * The list is DERIVED from the module registry: each module declares its optional
 * `createAction` (order, permission, ready, href) on its manifest — the one
 * surface (ADR-014). Nothing is hand-listed here.
 *   • `ready` types have a working entry point; other installed modules with a
 *     create action show as "Coming soon".
 *   • A type is offered only when its module is installed and the user's role
 *     can write it (viewers get nothing to create).
 *   • Owners also see "More you can add" — modules with a create action that are
 *     NOT installed — as a soft upsell. Editors and viewers never do.
 * Media Library is a platform surface, not a module: the sheet adds it itself.
 */
import type { ProjectGrant } from '@/lib/api/tenant-context'
import { MODULE_REGISTRY } from './registry'
import type { ModuleCreateAction, ModuleManifest } from './types'

/** Adding modules to a site (ADR-028: Owner only). */
const MODULES_MANAGE_PERMISSION = 'modules.manage'

export type CreateContentType = ModuleCreateAction & { moduleId: string }

/** Create actions declared by the modules, in `createOrder`. */
export function createContentTypes(registry: ModuleManifest[] = MODULE_REGISTRY): CreateContentType[] {
  return registry
    .flatMap((m) => (m.createAction ? [{ ...m.createAction, moduleId: m.id }] : []))
    .sort((a, b) => a.createOrder - b.createOrder)
}

export const CREATE_CONTENT_TYPES: CreateContentType[] = createContentTypes()

export type CreateMenu = {
  /** Installed types the user may create, in display order. `href` is locale-agnostic (absent when not ready). */
  available: { moduleId: string; ready: boolean; iconKey: string; href?: string }[]
  /** Not-installed content modules (owners only). */
  more: string[]
}

export function buildCreateMenu(
  grant: Pick<ProjectGrant, 'permissions' | 'enabledModuleIds' | 'projectSlug'>,
  types: CreateContentType[] = CREATE_CONTENT_TYPES
): CreateMenu {
  const installed = new Set(grant.enabledModuleIds)
  return {
    available: types
      .filter((t) => installed.has(t.moduleId) && grant.permissions.includes(t.permission))
      .map((t) => ({ moduleId: t.moduleId, ready: t.ready, iconKey: t.iconKey ?? t.moduleId, ...(t.ready && t.href ? { href: t.href(grant.projectSlug) } : {}) })),
    more: grant.permissions.includes(MODULES_MANAGE_PERMISSION) ? types.filter((t) => !installed.has(t.moduleId)).map((t) => t.moduleId) : [],
  }
}
