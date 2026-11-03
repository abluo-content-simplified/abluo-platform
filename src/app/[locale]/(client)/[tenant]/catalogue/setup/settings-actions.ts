'use server'

/**
 * Catalogue → Setup — module-configuration server actions (C2, C3-6, C11, D-1, D-14, C9 R2 lock).
 * Thin wrappers over `catalogueSettingsService` (src/lib/modules/catalogue/settings/service.ts),
 * the ONLY dashboard writer of the Catalogue installation's `config`. Every write is a key-level
 * patch guarded by the project revision the screen loaded (`rev`); `conflict` = reload.
 *
 * Every action takes `{ projectSlug, … }` and returns `{ ok: true, … }` or a `Fail`:
 *   { ok: false, error: 'unauthenticated' | 'forbidden' | CatalogueSettingsErrorCode, capability?, detail? }
 *
 * Signatures (input → success payload; all need catalogue.setup.manage except the load):
 *   loadCatalogueSettingsAction          {}                                         → { settings: CatalogueSettingsView }       item.read
 *   saveCatalogueChannelsAction          { rev, channels: ChannelInput[], confirmImpact? } → SaveChannelsResult                setup.manage
 *        saved:false = rule changes with impact: show `changes[]` (kind, channelKey, impact) and resend with confirmImpact:true
 *   previewCatalogueChannelRemovalAction { key }                                    → { key, usage: ChannelUsage }
 *   removeCatalogueChannelAction         { rev, key, expected: ChannelUsage }       → { key, cleanup, rev }    channel_usage_changed = show the new counts
 *   saveCatalogueSettingsAction          { rev, set: SettingsSet, confirmCurrency? } → SaveSettingsResult
 *        set keys: currency | publicSegment | publicName | defaultItemProfile | showPricesByDefault | formatTemplates | dietaryTags
 *        saved:false + confirmation.currency = "N prices across M items will be read as XXX" — resend with confirmCurrency:true
 *   completeCatalogueSetupAction         { rev, source: 'empty' | 'manual' | 'pack' } → { completedAt, source, rev }
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { catalogueRefusal } from '@/lib/api/catalogue-capability-guard'
import type { CatalogueCapability } from '@/lib/modules/catalogue/capabilities'
import type { ChannelUsage } from '@/lib/modules/catalogue/commerce/channels'
import type { SetupSource } from '@/lib/modules/catalogue/settings/model'
import {
  CatalogueSettingsError,
  completeCatalogueSetup,
  loadCatalogueSettings,
  previewCatalogueChannelRemoval,
  removeCatalogueChannel,
  saveCatalogueChannels,
  saveCatalogueSettings,
  type CatalogueSettingsErrorCode,
  type CatalogueSettingsErrorDetail,
  type CatalogueSettingsView,
  type SaveChannelsResult,
  type SaveSettingsResult,
  type SettingsSet,
} from '@/lib/modules/catalogue/settings/service'
import { CatalogueTaxonomyError } from '@/lib/modules/catalogue/taxonomy/service'

export type CatalogueSettingsActionError = 'unauthenticated' | 'forbidden' | 'failed' | CatalogueSettingsErrorCode
export type CatalogueSettingsFail = { ok: false; error: CatalogueSettingsActionError; capability?: CatalogueCapability; detail?: CatalogueSettingsErrorDetail }
type Result<T> = ({ ok: true } & T) | CatalogueSettingsFail
type Scoped<T = object> = { projectSlug: string } & T

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>, opts: { write?: boolean } = {}): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const value = await fn(access.ctx, access.grant.projectId)
    if (opts.write) refresh()
    return { ok: true, ...value }
  } catch (error) {
    if (error instanceof CatalogueSettingsError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
    // The channel cleanup prunes category rules through the taxonomy service; its conflict reads as ours.
    if (error instanceof CatalogueTaxonomyError) return { ok: false, error: error.code === 'category_conflict' ? 'conflict' : 'failed' }
    const refusal = catalogueRefusal(error)
    if (refusal) return refusal
    return { ok: false, error: 'failed' }
  }
}

function refresh() {
  try {
    revalidatePath('/[locale]/[tenant]/catalogue', 'layout')
  } catch {
    /* not in a request (tests) */
  }
}

export async function loadCatalogueSettingsAction(input: Scoped): Promise<Result<{ settings: CatalogueSettingsView }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ settings: await loadCatalogueSettings(ctx, pid) }))
}

export async function saveCatalogueChannelsAction(input: Scoped<{ rev: string; channels: unknown; confirmImpact?: boolean }>): Promise<Result<SaveChannelsResult>> {
  return run(input?.projectSlug, (ctx, pid) => saveCatalogueChannels(ctx, pid, { rev: input.rev, channels: input.channels, confirmImpact: input.confirmImpact }), { write: true })
}

export async function previewCatalogueChannelRemovalAction(input: Scoped<{ key: string }>): Promise<Result<{ key: string; usage: ChannelUsage }>> {
  return run(input?.projectSlug, (ctx, pid) => previewCatalogueChannelRemoval(ctx, pid, { key: input.key }))
}

export async function removeCatalogueChannelAction(input: Scoped<{ rev: string; key: string; expected: ChannelUsage }>): Promise<Result<{ key: string; cleanup: ChannelUsage; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => removeCatalogueChannel(ctx, pid, { rev: input.rev, key: input.key, expected: input.expected }), { write: true })
}

export async function saveCatalogueSettingsAction(input: Scoped<{ rev: string; set: SettingsSet; confirmCurrency?: boolean }>): Promise<Result<SaveSettingsResult>> {
  return run(input?.projectSlug, (ctx, pid) => saveCatalogueSettings(ctx, pid, { rev: input.rev, set: input.set, confirmCurrency: input.confirmCurrency }), { write: true })
}

export async function completeCatalogueSetupAction(input: Scoped<{ rev: string; source: SetupSource }>): Promise<Result<{ completedAt: string; source: SetupSource; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => completeCatalogueSetup(ctx, pid, { rev: input.rev, source: input.source }), { write: true })
}
