import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleSearchDef } from '@/lib/modules/types'
import { MEDIA_SEARCH } from './media-source'

/** One searchable surface: the module that owns it (none for the Media Library) and its declaration. */
export type SearchSource = { moduleId?: string; def: ModuleSearchDef }

/** Every declared source — modules from the registry, plus the platform Media Library. */
export function allSearchSources(): SearchSource[] {
  const fromModules = MODULE_REGISTRY.flatMap((m) => (m.search ? [{ moduleId: m.id, def: m.search }] : []))
  return [...fromModules, { def: MEDIA_SEARCH }]
}
