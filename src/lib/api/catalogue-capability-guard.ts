/**
 * Catalogue capability guard (C8 §8.4–8.6). Server-side, no I/O.
 *
 * `assertCatalogueOperation` checks EVERY capability `capabilitiesFor(op)`
 * returns through `assertModuleAction` (module installed + role grants it,
 * support-mode refusals included), before the caller does any I/O. A missing
 * capability throws `CatalogueForbidden(capability)` — a
 * `TenantAuthorizationError` subclass carrying the stable id, so refusals are
 * mapped structurally (`catalogueRefusal`), never by parsing the free-text
 * message (which names role and project). A project without the Catalogue (or
 * no grant at all) keeps the plain generic refusal: it never reveals whether
 * the permission would have been held (C8 §8.6, step-4 rule).
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { capabilitiesForPlan, type CatalogueCapability, type CatalogueOperation, type CatalogueRefusal } from '@/lib/modules/catalogue/capabilities'

export class CatalogueForbidden extends TenantAuthorizationError {
  constructor(readonly capability: CatalogueCapability) {
    super(`Missing ${capability}.`)
    this.name = 'CatalogueForbidden'
  }
}

/** True when the caller's grant for the project holds the capability (and the module is on). UI hints / branch choice. */
export function holdsCatalogueCapability(ctx: TenantAuthorizationContext, projectId: string, capability: CatalogueCapability): boolean {
  try {
    assertModuleAction(ctx, projectId, capability)
    return true
  } catch {
    return false
  }
}

/** Checks every capability of every operation, in stable order; throws on the FIRST missing one. */
export function assertCatalogueOperation(ctx: TenantAuthorizationContext, projectId: string, ops: CatalogueOperation | readonly CatalogueOperation[]): void {
  const list = Array.isArray(ops) ? (ops as readonly CatalogueOperation[]) : [ops as CatalogueOperation]
  assertCatalogueCapabilities(ctx, projectId, capabilitiesForPlan(list))
}

/** Checks the given capabilities (e.g. `catalogue.item.read` for a list), in order; throws on the first missing one. */
export function assertCatalogueCapabilities(ctx: TenantAuthorizationContext, projectId: string, capabilities: readonly CatalogueCapability[]): void {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  for (const capability of capabilities) {
    try {
      assertModuleAction(ctx, projectId, capability)
    } catch (error) {
      // No grant or no Catalogue on this project: the generic refusal, naming nothing.
      if (!grant || !grant.enabledModuleIds.includes('catalogue')) throw error
      throw new CatalogueForbidden(capability)
    }
  }
}

/** Refusal shape for a server action (C8 §8.6), or null when `error` is not an authorisation error. */
export function catalogueRefusal(error: unknown): CatalogueRefusal | null {
  if (error instanceof CatalogueForbidden) return { ok: false, error: 'forbidden', capability: error.capability }
  if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
  return null
}
