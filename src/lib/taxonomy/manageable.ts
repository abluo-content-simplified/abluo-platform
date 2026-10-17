// ── Which modules' terms a person can open in the manager ─────────────────────
// ADR-033 Amendment J (J-6). Pure. A module counts when it is installed on the
// project, its manifest declares `taxonomies`, and the person holds its
// taxonomy write permission OR its read permission (viewers list read-only).
// The service re-checks every call; this only decides what the screen offers.

import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleManifest } from '@/lib/modules/types'
import { taxonomyReadPermission, taxonomyWritePermission } from './permissions'

export type ManageableModule = {
  module: string
  /** Kinds the module declares, in manifest order (`category`, `tag`). */
  kinds: string[]
  canWrite: boolean
}

export function manageableTaxonomyModules(
  grant: { permissions: readonly string[]; enabledModuleIds: readonly string[] },
  registry: readonly ModuleManifest[] = MODULE_REGISTRY,
): ManageableModule[] {
  const out: ManageableModule[] = []
  for (const m of registry) {
    if (!m.taxonomies?.length || !grant.enabledModuleIds.includes(m.id)) continue
    const canWrite = grant.permissions.includes(taxonomyWritePermission(m.id))
    if (!canWrite && !grant.permissions.includes(taxonomyReadPermission(m.id, registry))) continue
    out.push({ module: m.id, kinds: Array.from(new Set(m.taxonomies.map((t) => t.kind))), canWrite })
  }
  return out
}
