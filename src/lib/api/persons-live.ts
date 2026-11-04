/**
 * People — what the editor needs for "View on website" and the photo's focus
 * point (ADR-043 D4/D8). Read-only; both bound to the GRANT's project.
 *
 *  - `getPersonLiveInfo`: the PUBLISHED person's visibility, slugs and archived
 *    state, the canonical origin (ADR-034) and the People module's profile
 *    segments. The URL itself is `personLiveUrl` (pure). `people.person.read`.
 *  - `getPersonPhotoFocal`: the Media Library asset behind the person's photo —
 *    original URL and focal point (Sanity hotspot). Needs the Media screen's
 *    permission, the same one that saves the focal point.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { assertProjectAccess, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { canonicalOrigin } from '@/lib/seo/canonical'
import { cleanProfileSegments } from '@/lib/modules/people/website'
import { PEOPLE_MODULE_ID } from '@/lib/modules/people/model'
import type { PersonLiveInfo } from '@/lib/modules/people/live-url'
import { PEOPLE_READ_PERMISSION, PersonError, isPersonId } from '@/lib/api/persons-lifecycle'

type Fetch = (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>
export type PersonLiveDeps = { client?: { fetch: Fetch } }

const RAW = { perspective: 'raw' } as const
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Exported so tests assert exactly what runs. */
export const PERSON_LIVE_QUERY = /* groq */ `{
  "person": *[_id == $id && _type == "person" && projectSlug == $projectSlug][0]{ visibility, slug, archivedAt, anonymisedAt },
  "domain": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && defined(customDomain)][0].customDomain,
  "segment": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == $moduleId && enabled != false][0].config.profileSegment
}`

export async function getPersonLiveInfo(ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps: PersonLiveDeps = {}): Promise<PersonLiveInfo> {
  assertModuleAction(ctx, projectId, PEOPLE_READ_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) throw new PersonError('forbidden', 'No access to this project.')
  if (!input || !isPersonId(input.id)) throw new PersonError('not_found', 'Unknown person.')
  const client = deps.client ?? sanityWriteClient
  // Only the published document: a draft has no live page. (The id is the base id.)
  const r = (await client.fetch(PERSON_LIVE_QUERY, { id: input.id, projectSlug: grant.projectSlug, moduleId: PEOPLE_MODULE_ID }, RAW)) as {
    person?: { visibility?: unknown; slug?: unknown; archivedAt?: unknown; anonymisedAt?: unknown } | null
    domain?: unknown
    segment?: unknown
  } | null
  const p = r?.person ?? null
  const visibility = p?.visibility === 'off' || p?.visibility === 'page' ? p.visibility : 'listed'
  const domain = str(r?.domain).trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return {
    origin: canonicalOrigin(/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain.toLowerCase() : null),
    published: Boolean(p),
    archived: Boolean(str(p?.archivedAt)),
    anonymised: Boolean(str(p?.anonymisedAt)),
    visibility,
    slugs: localizedSlugs(p?.slug),
    segments: cleanProfileSegments(r?.segment),
  }
}

function localizedSlugs(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith('_')) continue
    const cur = x && typeof x === 'object' ? str((x as { current?: unknown }).current) : ''
    if (cur) out[k] = cur
  }
  return out
}
export type PersonPhotoFocal = { assetId: string; rev: string; url: string; focal: { x: number; y: number } | null }

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export async function getPersonPhotoFocal(ctx: TenantAuthorizationContext, projectId: string, input: { assetId: string }, deps: PersonLiveDeps = {}): Promise<PersonPhotoFocal> {
  const grant = assertProjectAccess(ctx, projectId, MEDIA_MANAGE_PERMISSION)
  if (!input || typeof input.assetId !== 'string' || !ASSET_ID.test(input.assetId)) throw new PersonError('not_found', 'Unknown photo.')
  const client = deps.client ?? sanityWriteClient
  const a = (await client.fetch(
    `*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug][0]{ _rev, "url": image.asset->url, "hotspot": image.hotspot }`,
    { id: input.assetId, projectSlug: grant.projectSlug },
    RAW
  )) as { _rev?: unknown; url?: unknown; hotspot?: { x?: unknown; y?: unknown } | null } | null
  if (!a || !str(a.url)) throw new PersonError('not_found', 'Unknown photo.')
  const h = a.hotspot
  const focal = h && typeof h.x === 'number' && typeof h.y === 'number' ? { x: h.x, y: h.y } : null
  return { assetId: input.assetId, rev: str(a._rev), url: str(a.url), focal }
}
