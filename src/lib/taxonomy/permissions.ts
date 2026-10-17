// ── Taxonomy permissions ──────────────────────────────────────────────────────
// ADR-033 Amendment J. Pure and browser-safe (type-only registry import), so the
// service (server) and the sidebar / page (who may see the manager) agree on
// exactly one definition.

import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleManifest } from '@/lib/modules/types'

export const taxonomyWritePermission = (module: string) => `${module}.taxonomy.write`

/** The module's read permission (`<module>.<noun>.read`), falling back to the write one. */
export function taxonomyReadPermission(module: string, registry: readonly ModuleManifest[] = MODULE_REGISTRY): string {
  const manifest = registry.find((m) => m.id === module)
  const read = manifest?.platformContract.permissions.find((p) => p.id.startsWith(`${module}.`) && p.id.endsWith('.read'))
  return read?.id ?? taxonomyWritePermission(module)
}
