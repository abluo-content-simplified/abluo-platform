/**
 * Settings service — the dashboard's only writer of the client-owned business
 * facts on the Settings page (Tom, 2026-10-18). Server-only: it imports the
 * token-carrying Sanity write client.
 *
 * Every function, in this order:
 *   1. the caller's grant for THIS project must hold `site.details.read` /
 *      `site.details.write` (checked before any I/O; a viewer-style support
 *      visit has write stripped upstream);
 *   2. every value is checked against the fixed allow-list in `./paths`
 *      (`amazonTrackingIds`, `affiliateDisclosure.<locale>`) — nothing else
 *      can be written, whatever the client sends;
 *   3. reads go through `tenantScopedSanityClient` (forces `$projectSlug`);
 *      `assertSingleSanityProject` runs before the mutation.
 *
 * Writes (one transaction, all or nothing):
 *   • siteConfig is NOT liveEdit: the PUBLISHED document is patched with
 *     `ifRevisionID` (the revision the page loaded) AND, when Studio holds a
 *     draft, the same field on the DRAFT too — otherwise the next Studio
 *     Publish would restore the old value over the client's change.
 *   • the Catalogue's disclosure is a key-level patch on the project document's
 *     `moduleInstallations[_key==…].config.affiliateDisclosure.<locale>`, with
 *     `ifRevisionID` — never a whole-object replace.
 * A revision mismatch is `conflict` ("changed elsewhere"); the page reloads.
 */
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError, tenantScopedSanityClient, type TenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { moduleConfigTypeName } from '@/lib/modules/config-schema'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { span } from '@/lib/perf/timing'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import type { AmazonTrackingId } from '@/lib/affiliate/amazon-marketplaces'
import { rowsFromStored } from './amazon-rows'
import { buildDisclosurePatch } from './disclosure-patch'
import { decodeRev, encodeRev, parseSettingsSet } from './paths'

export const SETTINGS_READ = 'site.details.read'
export const SETTINGS_WRITE = 'site.details.write'

export type SettingsErrorCode =
  | 'invalid_field'
  | 'invalid_value'
  | 'invalid_marketplace'
  | 'duplicate_marketplace'
  | 'too_many'
  | 'not_found'
  | 'catalogue_not_installed'
  /** The page's copy is out of date (revision guard). */
  | 'conflict'
  | 'failed'

export class SettingsError extends Error {
  constructor(readonly code: SettingsErrorCode, message?: string) {
    super(message ?? code)
  }
}

export type SettingsView = {
  /** Opaque: pass back unchanged to `saveSettings`. */
  rev: string
  defaultLocale: string
  locales: string[]
  amazon: AmazonTrackingId[]
  catalogueInstalled: boolean
  /** Stored affiliate disclosure per site language (missing = empty = standard wording). */
  disclosure: Record<string, string>
  canWrite: boolean
}

type Client = Pick<typeof sanityWriteClient, 'fetch' | 'transaction'>
export type SettingsDeps = { client?: Client }

type SiteDoc = { _id: string; _rev: string; defaultLocale?: string | null; supportedLocales?: string[] | null; amazonTrackingIds?: Array<Partial<AmazonTrackingId>> | null }
type ProjectDoc = {
  _id: string
  _rev: string
  catalogue?: { _key?: string | null; enabled?: boolean | null; hasConfig?: boolean | null; disclosure?: Record<string, unknown> | null } | null
} | null

export const SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug]{ _id, _rev, defaultLocale, supportedLocales, amazonTrackingIds }`
export const PROJECT_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ _id, _rev, "catalogue": moduleInstallations[moduleId == "catalogue"][0]{ _key, enabled, "hasConfig": defined(config), "disclosure": config.affiliateDisclosure } }`

const isDraft = (id: string) => id.startsWith('drafts.')

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant || !grant.permissions.includes(permission)) throw new TenantAuthorizationError(`Missing ${permission} on project.`)
  return grant
}

function scopedClient(ctx: TenantAuthorizationContext, projectId: string, client: Client): TenantScopedSanityClient {
  return tenantScopedSanityClient(ctx, projectId, {
    fetch: <T>(query: string, params?: Record<string, unknown>) => client.fetch(query, params ?? {}) as Promise<T>,
  })
}

async function readDocs(scoped: TenantScopedSanityClient) {
  const [sites, project] = await Promise.all([
    span('sanity.readSite', () => scoped.fetch<SiteDoc[] | null>(SITE_QUERY)),
    span('sanity.readProject', () => scoped.fetch<ProjectDoc>(PROJECT_QUERY)),
  ])
  const all = sites ?? []
  return { published: all.find((d) => !isDraft(d._id)) ?? null, draft: all.find((d) => isDraft(d._id)) ?? null, project: project ?? null }
}

const localesOf = (site: SiteDoc): string[] => {
  const def = site.defaultLocale || 'en'
  const list = (site.supportedLocales ?? []).filter(Boolean)
  return [def, ...list.filter((l) => l !== def)]
}

function catalogueActive(enabledModuleIds: readonly string[], project: ProjectDoc): boolean {
  return enabledModuleIds.includes('catalogue') && !!project?.catalogue && project.catalogue.enabled !== false
}

export async function loadSettings(ctx: TenantAuthorizationContext, projectId: string, deps: SettingsDeps = {}): Promise<SettingsView> {
  const grant = grantFor(ctx, projectId, SETTINGS_READ)
  const client = deps.client ?? sanityWriteClient
  const { published, project } = await readDocs(scopedClient(ctx, projectId, client))
  if (!published) throw new SettingsError('not_found', 'No site configuration.')
  const installed = catalogueActive(grant.enabledModuleIds, project)
  const stored = (installed ? project?.catalogue?.disclosure : null) ?? {}
  const disclosure: Record<string, string> = {}
  for (const [k, v] of Object.entries(stored)) if (typeof v === 'string' && v.trim() && !k.startsWith('_') && k !== 'translationStatus') disclosure[k] = v
  return {
    rev: encodeRev(published._rev, project?._rev ?? ''),
    defaultLocale: published.defaultLocale || 'en',
    locales: localesOf(published),
    amazon: rowsFromStored(published.amazonTrackingIds).map((r) => ({ _key: r.key, marketplace: r.marketplace as AmazonTrackingId['marketplace'], trackingId: r.trackingId })),
    catalogueInstalled: installed,
    disclosure,
    canWrite: grant.permissions.includes(SETTINGS_WRITE),
  }
}

function isConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return e?.statusCode === 409 || e?.response?.statusCode === 409 || /revision/i.test(String(e?.message ?? ''))
}

/**
 * Applies a batch of `{ path: value }` changes. `rev` is the opaque revision
 * from `loadSettings` (or the previous save). Returns the new revision.
 */
export async function saveSettings(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { rev: string; set: unknown },
  deps: SettingsDeps = {},
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, SETTINGS_WRITE)
  const parsed = parseSettingsSet(input?.set)
  if (!parsed.ok) throw new SettingsError(parsed.error)
  const { siteRev, projectRev } = decodeRev(input?.rev)

  const client = deps.client ?? sanityWriteClient
  const scoped = scopedClient(ctx, projectId, client)
  await span('sanity.assertSingleProject', () => assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug))
  const { published, draft, project } = await readDocs(scoped)
  if (!published) throw new SettingsError('not_found', 'No site configuration.')

  const tx = client.transaction()
  let touched = 0

  if (parsed.amazon !== undefined) {
    if (!siteRev) throw new SettingsError('invalid_value', 'Missing revision.')
    const change = parsed.amazon.length ? { set: { amazonTrackingIds: parsed.amazon } } : { unset: ['amazonTrackingIds'] }
    tx.patch(published._id, { ifRevisionID: siteRev, ...change })
    // Studio's unpublished draft would otherwise win at the next Publish.
    if (draft) tx.patch(draft._id, { ifRevisionID: draft._rev, ...change })
    touched++
  }

  const edits = parsed.disclosure
  if (Object.keys(edits).length > 0) {
    if (!catalogueActive(grant.enabledModuleIds, project) || !project) throw new SettingsError('catalogue_not_installed')
    if (!projectRev) throw new SettingsError('invalid_value', 'Missing revision.')
    const known = new Set(localesOf(published))
    if (Object.keys(edits).some((l) => !known.has(l))) throw new SettingsError('invalid_field', 'Unknown language.')
    const manifest = MODULE_REGISTRY.find((m) => m.id === 'catalogue')
    if (!manifest) throw new SettingsError('failed')
    const cat = project.catalogue!
    const patch = buildDisclosurePatch(
      { _key: cat._key ?? null, hasConfig: cat.hasConfig === true, disclosure: cat.disclosure ?? null },
      edits,
      moduleConfigTypeName(manifest),
    )
    if (Object.keys(patch.set).length || patch.unset.length) {
      tx.patch(project._id, {
        ifRevisionID: projectRev,
        ...(Object.keys(patch.set).length ? { set: patch.set } : {}),
        ...(patch.unset.length ? { unset: patch.unset } : {}),
      })
      touched++
    }
  }

  if (touched === 0) return { rev: encodeRev(published._rev, project?._rev ?? '') }
  try {
    await span('sanity.commit', () => tx.commit())
  } catch (error) {
    throw new SettingsError(isConflict(error) ? 'conflict' : 'failed', isConflict(error) ? 'This was changed elsewhere.' : 'Could not save.')
  }
  const after = await readDocs(scoped)
  return { rev: encodeRev(after.published?._rev ?? '', after.project?._rev ?? '') }
}
