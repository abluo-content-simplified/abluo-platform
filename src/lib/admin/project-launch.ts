// Server-only: service-role and Sanity write-token writes; never import from a client component.
/**
 * A project's domain and "go live" — set from the admin, not by hand in
 * Supabase (Tom, 2026-11-05). Callers MUST have passed `requireAbluoAdmin()`.
 *
 * Two records carry them, and both are written together:
 *
 *   - Supabase `projects.custom_domain` / `projects.status` — what ROUTING
 *     reads (the generated route table, `npm run routes:generate`).
 *   - Sanity `project.customDomain` / `project.status` — what the dashboards
 *     (live links) and the sitemap / llms.txt read (`status == "active"`).
 *
 * Neither changes which site answers on which address until the route table
 * is regenerated and deployed — the screen says so.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { GENERATED_PLATFORM_HOSTS } from '@/lib/tenancy/generated/route-config'
import { normaliseDomain } from '@/lib/admin/provisioning/reachability'

export type DomainError = 'invalid' | 'platform' | 'taken' | 'not_found' | 'needs_domain' | 'failed'
export type LaunchResult<T> = ({ ok: true } & T) | { ok: false; error: DomainError }

/** A registrable host: labels of letters, digits and inner hyphens, a letter TLD (punycode allowed). */
const HOST = /^(?=.{4,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/**
 * The domain as stored (lowercase, no scheme, path, port or leading `www.`),
 * `null` to clear it, or the reason it is refused. Pure.
 */
export function validateCustomDomain(input: unknown, platformHosts: readonly string[] = GENERATED_PLATFORM_HOSTS): { ok: true; domain: string | null } | { ok: false; error: 'invalid' | 'platform' } {
  if (input === null || (typeof input === 'string' && !input.trim())) return { ok: true, domain: null }
  if (typeof input !== 'string' || input.length > 300) return { ok: false, error: 'invalid' }
  const domain = normaliseDomain(input)
  if (!domain || !HOST.test(domain)) return { ok: false, error: 'invalid' }
  // An Abluo / Vercel host is the platform's, never a client's own domain.
  const isPlatform = [...platformHosts, 'abluo.app', 'vercel.app'].some((h) => domain === h || domain.endsWith(`.${h}`))
  if (isPlatform) return { ok: false, error: 'platform' }
  return { ok: true, domain }
}

type SanityWriter = {
  fetch: <T>(query: string, params?: Record<string, unknown>) => Promise<T>
  patch: (id: string) => { set: (v: Record<string, unknown>) => { unset: (k: string[]) => { commit: () => Promise<unknown> }; commit: () => Promise<unknown> }; unset: (k: string[]) => { commit: () => Promise<unknown> } }
}

/** The Sanity `project` document of this slug (published) and its open draft, if any. */
async function sanityProjectIds(sanity: SanityWriter, slug: string): Promise<string[] | null> {
  const ids = await sanity.fetch<string[]>(`*[_type == "project" && projectSlug == $slug]._id`, { slug })
  const published = (ids ?? []).filter((id) => !id.startsWith('drafts.') && !id.startsWith('versions.'))
  if (published.length !== 1) return null
  return (ids ?? []).filter((id) => id === published[0] || id === `drafts.${published[0]}`)
}

async function readProject(db: SupabaseClient, projectId: string) {
  const { data, error } = await db.from('projects').select('id, slug, custom_domain, status').eq('id', projectId).maybeSingle()
  if (error) return { error: 'failed' as const }
  if (!data) return { error: 'not_found' as const }
  return { row: data as { id: string; slug: string; custom_domain: string | null; status: string | null } }
}

/** Sets (or clears, with '' / null) the project's own domain in Supabase and Sanity. */
export async function saveProjectDomain(
  db: SupabaseClient,
  sanity: SanityWriter,
  projectId: string,
  input: unknown
): Promise<LaunchResult<{ domain: string | null }>> {
  const v = validateCustomDomain(input)
  if (!v.ok) return v
  const p = await readProject(db, projectId)
  if ('error' in p) return { ok: false, error: p.error as DomainError }
  if (v.domain) {
    const { data: other, error } = await db.from('projects').select('id').eq('custom_domain', v.domain).neq('id', projectId).limit(1)
    if (error) return { ok: false, error: 'failed' }
    if ((other ?? []).length) return { ok: false, error: 'taken' }
  }
  const ids = await sanityProjectIds(sanity, p.row.slug).catch(() => null)
  if (!ids) return { ok: false, error: 'failed' }

  const { error: updateError } = await db.from('projects').update({ custom_domain: v.domain }).eq('id', projectId)
  if (updateError) return { ok: false, error: (updateError as { code?: string }).code === '23505' ? 'taken' : 'failed' }
  try {
    for (const id of ids) {
      await (v.domain ? sanity.patch(id).set({ customDomain: v.domain }).commit() : sanity.patch(id).unset(['customDomain']).commit())
    }
  } catch {
    return { ok: false, error: 'failed' }
  }
  return { ok: true, domain: v.domain }
}

/**
 * Live = `active` (served on its own domain, in the sitemap); not live =
 * `preview` (its preview address only). Going live needs a domain.
 */
export async function setProjectLive(
  db: SupabaseClient,
  sanity: SanityWriter,
  projectId: string,
  live: boolean
): Promise<LaunchResult<{ status: 'active' | 'preview' }>> {
  if (typeof live !== 'boolean') return { ok: false, error: 'invalid' }
  const p = await readProject(db, projectId)
  if ('error' in p) return { ok: false, error: p.error as DomainError }
  if (live && !normaliseDomain(p.row.custom_domain)) return { ok: false, error: 'needs_domain' }
  const ids = await sanityProjectIds(sanity, p.row.slug).catch(() => null)
  if (!ids) return { ok: false, error: 'failed' }
  const status = live ? 'active' : 'preview'
  const { error } = await db.from('projects').update({ status }).eq('id', projectId)
  if (error) return { ok: false, error: 'failed' }
  try {
    for (const id of ids) await sanity.patch(id).set({ status: live ? 'active' : 'inactive' }).commit()
  } catch {
    return { ok: false, error: 'failed' }
  }
  return { ok: true, status }
}
