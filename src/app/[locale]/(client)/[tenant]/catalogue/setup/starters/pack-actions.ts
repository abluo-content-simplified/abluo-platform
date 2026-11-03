'use server'

/**
 * Catalogue → Setup → Starter Structures — server actions (C7). Thin wrappers over the pack service
 * (`src/lib/modules/catalogue/packs/service.ts`); every action needs `catalogue.setup.manage`
 * (`setup.applyPack`), checked by the service before any read.
 *
 *   loadStarterStructuresAction { }                                                → { view: StarterStructuresView }
 *   previewPackAction           { packId, selection?, update? }                    → { preview: PackPreview }      nothing written
 *   applyPackAction             { packId, version, selection, planFingerprint, update? } → { record } | Fail
 *        pack_plan_changed / pack_conflict carry the fresh plan in `detail.plan`: show it and ask again.
 *
 * Fail: { ok: false, error: 'unauthenticated' | 'forbidden' | PackErrorCode, capability?, detail? }
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { catalogueRefusal } from '@/lib/api/catalogue-capability-guard'
import type { CatalogueCapability } from '@/lib/modules/catalogue/capabilities'
import type { PackPlan, PackSelection } from '@/lib/modules/catalogue/packs/plan'
import { applyPack, loadStarterStructures, PackServiceError, previewPack, type PackErrorCode, type PackPreview, type StarterStructuresView } from '@/lib/modules/catalogue/packs/service'
import type { AppliedPackRecord } from '@/lib/modules/catalogue/packs/types'

export type PackActionFail = { ok: false; error: 'unauthenticated' | 'forbidden' | 'failed' | PackErrorCode; capability?: CatalogueCapability; detail?: { plan?: PackPlan } }
type Result<T> = ({ ok: true } & T) | PackActionFail
type Scoped<T = object> = { projectSlug: string } & T

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    return { ok: true, ...(await fn(access.ctx, access.grant.projectId)) }
  } catch (error) {
    if (error instanceof PackServiceError) return { ok: false, error: error.code }
    const refusal = catalogueRefusal(error)
    if (refusal) return refusal
    return { ok: false, error: 'failed' }
  }
}

export async function loadStarterStructuresAction(input: Scoped): Promise<Result<{ view: StarterStructuresView }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ view: await loadStarterStructures(ctx, pid) }))
}

export async function previewPackAction(input: Scoped<{ packId: string; selection?: PackSelection; update?: boolean }>): Promise<Result<{ preview: PackPreview }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ preview: await previewPack(ctx, pid, { packId: input.packId, selection: input.selection, update: input.update }) }))
}

export async function applyPackAction(input: Scoped<{ packId: string; version: number; selection: PackSelection; planFingerprint: string; update?: boolean }>): Promise<Result<{ record: AppliedPackRecord }>> {
  const r = await run(input?.projectSlug, async (ctx, pid) => ({ result: await applyPack(ctx, pid, { packId: input.packId, version: input.version, selection: input.selection, planFingerprint: input.planFingerprint, update: input.update }) }))
  if (!r.ok) return r
  if (!r.result.ok) return { ok: false, error: r.result.code === 'pack_forbidden' ? 'forbidden' : r.result.code, ...(r.result.code === 'pack_forbidden' && { capability: 'catalogue.setup.manage' as CatalogueCapability }), ...(r.result.plan && { detail: { plan: r.result.plan } }) }
  try {
    revalidatePath('/[locale]/[tenant]/catalogue', 'layout')
  } catch {
    /* not in a request (tests) */
  }
  return { ok: true, record: r.result.record }
}
