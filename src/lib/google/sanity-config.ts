/**
 * The two Sanity writes "Connect Google" makes, and nothing else:
 *
 *   siteConfig.googleSiteVerification   the Search Console meta token
 *                                       (Website Settings → SEO; rendered by
 *                                       the [tenant] layout in every environment)
 *   project.integrationConfigs[]        the google-analytics / google-search-console
 *                                       entries (ADR-014's one configuration surface)
 *
 * Draft policy: the PUBLISHED document is what the website and the snapshot
 * job read, so it is always the one patched. When Studio has an open draft of
 * the same document, the draft gets the same change in the same transaction —
 * otherwise publishing that draft later would silently undo the setup. No
 * draft is ever created. Each patch carries `ifRevisionID`, so a concurrent
 * edit fails the transaction (retry is safe) instead of being overwritten.
 */

export type SanityPort = {
  /** A GROQ read in the RAW perspective (drafts visible). */
  fetch: <T>(query: string, params: Record<string, unknown>) => Promise<T>
  /** One atomic transaction of raw mutations ({ patch: { id, ifRevisionID, set } }). */
  mutate: (mutations: Record<string, unknown>[]) => Promise<unknown>
}

export type IntegrationEntry = {
  _key?: string
  _type?: string
  integrationId?: string
  enabled?: boolean
  values?: Record<string, unknown> | null
}

type DocRow = { _id: string; _rev: string; integrationConfigs?: IntegrationEntry[] | null; googleSiteVerification?: string | null }
export type DocPair = { published: DocRow; draft: DocRow | null }

export type GoogleSanityState = { project: DocPair; siteConfig: DocPair }

/** Generated type names (src/lib/integrations/schema.ts naming: `${camelId}Integration{Config,Values}`). */
export const INTEGRATION_TYPES = {
  'google-analytics': { config: 'googleAnalyticsIntegrationConfig', values: 'googleAnalyticsIntegrationValues' },
  'google-search-console': { config: 'googleSearchConsoleIntegrationConfig', values: 'googleSearchConsoleIntegrationValues' },
} as const
export type GoogleIntegrationId = keyof typeof INTEGRATION_TYPES

const NOT_DRAFT = '!(_id in path("drafts.**")) && !(_id in path("versions.**"))'
const STATE_QUERY = /* groq */ `{
  "projects": *[_type == "project" && projectSlug == $slug && ${NOT_DRAFT}]{ _id, _rev, integrationConfigs },
  "siteConfigs": *[_type == "siteConfig" && projectSlug == $slug && ${NOT_DRAFT}]{ _id, _rev, googleSiteVerification }
}`
const DRAFTS_QUERY = /* groq */ `*[_id in $ids]{ _id, _rev, integrationConfigs, googleSiteVerification }`

/** Raised (as a GoogleSetupError by the caller) when the documents are not exactly one of each. */
export class SanityStateError extends Error {}

/** Reads the published project + siteConfig of one project (exactly one each) and their drafts, if any. */
export async function loadGoogleSanityState(port: SanityPort, slug: string): Promise<GoogleSanityState> {
  const { projects, siteConfigs } = await port.fetch<{ projects: DocRow[] | null; siteConfigs: DocRow[] | null }>(STATE_QUERY, { slug })
  const one = (rows: DocRow[] | null, what: string): DocRow => {
    if (!rows?.length) throw new SanityStateError(`No published ${what} document for project "${slug}" in Sanity.`)
    if (rows.length > 1) throw new SanityStateError(`${rows.length} published ${what} documents for project "${slug}" in Sanity — expected one.`)
    return rows[0]
  }
  const project = one(projects, 'project')
  const siteConfig = one(siteConfigs, 'siteConfig')
  const drafts = await port.fetch<DocRow[] | null>(DRAFTS_QUERY, { ids: [`drafts.${project._id}`, `drafts.${siteConfig._id}`] })
  const draftOf = (id: string) => drafts?.find((d) => d._id === `drafts.${id}`) ?? null
  return {
    project: { published: project, draft: draftOf(project._id) },
    siteConfig: { published: siteConfig, draft: draftOf(siteConfig._id) },
  }
}

/** Pure: the docs of a pair that need `field` changed. */
function docsNeeding(pair: DocPair, needs: (d: DocRow) => boolean): DocRow[] {
  return [pair.published, ...(pair.draft ? [pair.draft] : [])].filter(needs)
}

/** Sets siteConfig.googleSiteVerification (published + open draft). Returns false when already set. */
export async function writeSiteVerification(port: SanityPort, state: GoogleSanityState, token: string): Promise<boolean> {
  const docs = docsNeeding(state.siteConfig, (d) => d.googleSiteVerification !== token)
  if (!docs.length) return false
  await port.mutate(docs.map((d) => ({ patch: { id: d._id, ifRevisionID: d._rev, set: { googleSiteVerification: token } } })))
  return true
}

/** Pure: the integration entry for `id` in a configs array, if any. */
export function findIntegration(configs: readonly IntegrationEntry[] | null | undefined, id: GoogleIntegrationId): IntegrationEntry | undefined {
  return configs?.find((c) => c.integrationId === id)
}

/**
 * Pure: `configs` with the entry for `id` enabled and its values merged with
 * `values` (other values kept). A new entry gets the deterministic key
 * `integration-<id>`. Returns null when nothing would change.
 */
export function withIntegration(
  configs: readonly IntegrationEntry[] | null | undefined,
  id: GoogleIntegrationId,
  values: Record<string, string>,
): IntegrationEntry[] | null {
  const list = [...(configs ?? [])]
  const types = INTEGRATION_TYPES[id]
  const i = list.findIndex((c) => c.integrationId === id)
  const existing = i >= 0 ? list[i] : undefined
  const nextValues = { ...(existing?.values ?? {}), _type: types.values, ...values }
  const unchanged =
    existing &&
    existing.enabled === true &&
    existing._type === types.config &&
    existing.values?._type === types.values &&
    Object.entries(values).every(([k, v]) => existing.values?.[k] === v)
  if (unchanged) return null
  const entry: IntegrationEntry = {
    ...(existing ?? {}),
    _key: existing?._key ?? `integration-${id}`,
    _type: types.config,
    integrationId: id,
    enabled: true,
    values: nextValues,
  }
  if (i >= 0) list[i] = entry
  else list.push(entry)
  return list
}

/** Enables + updates one integration entry on the project document (published + open draft). Returns false when already so. */
export async function writeIntegration(
  port: SanityPort,
  state: GoogleSanityState,
  id: GoogleIntegrationId,
  values: Record<string, string>,
): Promise<boolean> {
  const docs = [state.project.published, ...(state.project.draft ? [state.project.draft] : [])]
  const mutations = docs.flatMap((d) => {
    const next = withIntegration(d.integrationConfigs, id, values)
    return next ? [{ patch: { id: d._id, ifRevisionID: d._rev, set: { integrationConfigs: next } } }] : []
  })
  if (!mutations.length) return false
  await port.mutate(mutations)
  return true
}
