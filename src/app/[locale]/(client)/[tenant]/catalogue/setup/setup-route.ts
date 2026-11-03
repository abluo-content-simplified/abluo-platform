import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext, type ProjectGrant, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { holdsCatalogueCapability } from '@/lib/api/catalogue-capability-guard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { canOpenSetupSection, setupHref, setupLanding, type SetupAccess, type SetupSection } from '@/components/client/catalogue/setup/setup-model'

export type SetupRoute = {
  ctx: TenantAuthorizationContext
  grant: ProjectGrant
  projectSlug: string
  access: SetupAccess
  /** The way back to the Overview (only for people who may open it). */
  backHref: string | null
}

/**
 * Opens one Catalogue → Setup section (ADR-042 N2a, spec §9.2) — the one permission check every
 * Setup page runs before reading anything. Signed out → sign in. No grant, no Catalogue, or no
 * permission for this section → 404, like any other permission failure (fail closed, nothing
 * leaks). `/catalogue/setup` itself lands on the Overview with the Setup permission and on
 * Categories & Tags with only the category permission.
 */
export async function openSetupSection(params: Promise<{ tenant: string }>, section: SetupSection): Promise<SetupRoute> {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=${setupHref(projectSlug, section)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes('catalogue')) notFound()
  const access: SetupAccess = {
    manage: holdsCatalogueCapability(ctx, grant.projectId, 'catalogue.setup.manage'),
    taxonomy: holdsCatalogueCapability(ctx, grant.projectId, 'catalogue.taxonomy.write'),
  }
  if (section === 'overview') {
    const landing = setupLanding(access)
    if (!landing) notFound()
    if (landing !== 'overview') redirect(setupHref(projectSlug, landing))
  } else if (!canOpenSetupSection(section, access)) {
    notFound()
  }
  return { ctx, grant, projectSlug, access, backHref: access.manage ? setupHref(projectSlug, 'overview') : null }
}

/** A read refused by the services (e.g. no `catalogue.item.read`) is a 404, never an error page. */
export async function readOr404<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
}

/** The currencies Setup offers: the Catalogue manifest's list (the one the settings service validates against). */
export function catalogueCurrencies(): string[] {
  const field = MODULE_REGISTRY.find((m) => m.id === 'catalogue')?.platformContract.configSchema.find((f) => f.id === 'currency')
  return (field?.options ?? []).map((o) => String(o.value))
}
