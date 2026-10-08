// Server-only: service-role and Sanity token reads; never import from a client component.
/**
 * What the wizard needs from the platform: the clients to pick from, the
 * design systems to start from, slug availability, and — at start — the facts
 * the planner needs (the existing client, its Sanity document, the picked
 * design system). Callers MUST have passed `requireAbluoAdmin()`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DesignSystemSource } from './design-system-copy'
import { sanityDocIds, validateSlug, type ValidWizardInput, type WizardErrors } from './model'
import type { PlanContext } from './plan'
import { slugHeldByRun } from './store'

export type SanityReader = { fetch: <T>(query: string, params?: Record<string, unknown>) => Promise<T> }

export type ClientOption = { id: string; slug: string; name: string }
export type DesignSystemOption = { id: string; name: string; role: 'template' | 'active'; projectSlug: string | null; parentName: string | null }

export async function loadClientOptions(db: SupabaseClient): Promise<ClientOption[] | null> {
  const { data, error } = await db.from('tenants').select('id, slug, display_name').order('display_name', { ascending: true })
  if (error) return null
  return ((data ?? []) as { id: string; slug: string; display_name: string | null }[]).map((t) => ({ id: t.id, slug: t.slug, name: t.display_name || t.slug }))
}

/** Published templates and every project's active system (drafts never). */
export const DESIGN_SYSTEM_OPTIONS_QUERY = /* groq */ `
  *[_type == "designSystem" && !(_id in path("drafts.**")) && (role == "template" || (role != "template" && defined(projectSlug)))]
  | order(role desc, name asc) {
    "id": _id,
    "name": coalesce(name, _id),
    "role": select(role == "template" => "template", "active"),
    "projectSlug": projectSlug,
    "parentName": parentDesignSystem->name
  }
`

export async function loadDesignSystemOptions(sanity: SanityReader): Promise<DesignSystemOption[] | null> {
  try {
    return await sanity.fetch<DesignSystemOption[]>(DESIGN_SYSTEM_OPTIONS_QUERY)
  } catch (e) {
    console.warn(`provisioning: design systems not loaded: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * Is this project slug free everywhere it would be used? Supabase `projects`
 * (across ALL clients — slugs are unique per client in the database since
 * migration 023, but the URL namespace is flat: preview.abluo.app/<slug>),
 * Sanity (any document carrying this projectSlug, or one of the ids the new
 * project would get), and runs in progress.
 */
export async function projectSlugTaken(db: SupabaseClient, sanity: SanityReader, slug: string, tenantSlugForIds: string): Promise<boolean | 'error'> {
  const ids = sanityDocIds(slug, tenantSlugForIds)
  const [{ data, error }, inSanity, inRun] = await Promise.all([
    db.from('projects').select('id').eq('slug', slug).limit(1),
    sanity
      .fetch<number>(`count(*[projectSlug == $slug || _id in $ids || _id in $draftIds])`, {
        slug,
        ids: [ids.designSystem, ids.project, ids.siteConfig, ids.homePage],
        draftIds: [ids.designSystem, ids.project, ids.siteConfig, ids.homePage].map((i) => `drafts.${i}`),
      })
      .catch(() => null),
    slugHeldByRun(db, slug),
  ])
  if (error || inSanity === null || typeof inRun === 'string') return 'error'
  return (data ?? []).length > 0 || inSanity > 0 || inRun
}

/** Is this client slug free (Supabase `tenants`, and no Sanity `client` document claims it)? */
export async function clientSlugTaken(db: SupabaseClient, sanity: SanityReader, slug: string): Promise<boolean | 'error'> {
  const [{ data, error }, inSanity] = await Promise.all([
    db.from('tenants').select('id').eq('slug', slug).limit(1),
    sanity.fetch<number>(`count(*[_type == "client" && (tenantSlug == $slug || _id == $id)])`, { slug, id: sanityDocIds('x', slug).client }).catch(() => null),
  ])
  if (error || inSanity === null) return 'error'
  return (data ?? []).length > 0 || inSanity > 0
}

export type AvailabilityResult = { ok: true } | { ok: false; errors: WizardErrors } | { ok: false; error: 'failed' }

/** Uniqueness checks for a validated input (format was checked by validateWizardInput). */
export async function checkAvailability(db: SupabaseClient, sanity: SanityReader, input: ValidWizardInput): Promise<AvailabilityResult> {
  const errors: WizardErrors = {}
  let tenantSlug: string
  if (input.client.mode === 'existing') {
    const { data, error } = await db.from('tenants').select('id, slug').eq('id', input.client.tenantId).maybeSingle()
    if (error) return { ok: false, error: 'failed' }
    if (!data) return { ok: false, errors: { client: 'notFound' } }
    tenantSlug = String((data as { slug: string }).slug)
  } else {
    tenantSlug = input.client.slug
    const taken = await clientSlugTaken(db, sanity, tenantSlug)
    if (taken === 'error') return { ok: false, error: 'failed' }
    if (taken) errors.clientSlug = 'taken'
  }
  const projectTaken = await projectSlugTaken(db, sanity, input.project.slug, tenantSlug)
  if (projectTaken === 'error') return { ok: false, error: 'failed' }
  if (projectTaken) errors.projectSlug = 'taken'

  const ds = await sanity
    .fetch<{ _id: string } | null>(`*[_type == "designSystem" && _id == $id][0]{ _id }`, { id: input.designSystemId })
    .catch(() => undefined)
  if (ds === undefined) return { ok: false, error: 'failed' }
  if (!ds) errors.designSystem = 'notFound'

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true }
}

/** Format-only check of one slug, plus availability — used by the "Next" button of the client and project steps. */
export async function checkSlugs(
  db: SupabaseClient,
  sanity: SanityReader,
  input: { clientSlug?: string | null; projectSlug?: string | null; tenantId?: string | null }
): Promise<{ ok: true; errors: WizardErrors } | { ok: false }> {
  const errors: WizardErrors = {}
  let tenantSlug = input.clientSlug ?? ''
  if (input.clientSlug != null) {
    const e = validateSlug(input.clientSlug)
    if (e) errors.clientSlug = e
    else {
      const taken = await clientSlugTaken(db, sanity, input.clientSlug)
      if (taken === 'error') return { ok: false }
      if (taken) errors.clientSlug = 'taken'
    }
  } else if (input.tenantId) {
    const { data } = await db.from('tenants').select('slug').eq('id', input.tenantId).maybeSingle()
    tenantSlug = String((data as { slug?: string } | null)?.slug ?? '')
  }
  if (input.projectSlug != null) {
    const e = validateSlug(input.projectSlug)
    if (e) errors.projectSlug = e
    else {
      const taken = await projectSlugTaken(db, sanity, input.projectSlug, tenantSlug || 'x')
      if (taken === 'error') return { ok: false }
      if (taken) errors.projectSlug = 'taken'
    }
  }
  return { ok: true, errors }
}

/**
 * The facts the planner needs, read once at start. `newId` supplies fresh
 * UUIDs (crypto.randomUUID in production) — only for the ids that do not
 * exist yet.
 */
export async function resolvePlanContext(
  db: SupabaseClient,
  sanity: SanityReader,
  input: ValidWizardInput,
  newId: () => string
): Promise<{ ok: true; ctx: PlanContext } | { ok: false; error: 'failed' | 'not_found' }> {
  let tenant: { id: string; slug: string; name: string }
  let existingClientDocId: string | null = null
  if (input.client.mode === 'existing') {
    const { data, error } = await db.from('tenants').select('id, slug, display_name').eq('id', input.client.tenantId).maybeSingle()
    if (error) return { ok: false, error: 'failed' }
    if (!data) return { ok: false, error: 'not_found' }
    const t = data as { id: string; slug: string; display_name: string | null }
    tenant = { id: t.id, slug: t.slug, name: t.display_name || t.slug }
    try {
      existingClientDocId = await sanity.fetch<string | null>(`*[_type == "client" && tenantId == $tenantId && !(_id in path("drafts.**"))][0]._id`, { tenantId: t.id })
    } catch {
      return { ok: false, error: 'failed' }
    }
  } else {
    tenant = { id: newId(), slug: input.client.slug, name: input.client.name }
  }

  let designSystem: DesignSystemSource | null
  try {
    designSystem = await sanity.fetch<DesignSystemSource | null>(`*[_type == "designSystem" && _id == $id][0]`, { id: input.designSystemId })
  } catch {
    return { ok: false, error: 'failed' }
  }
  if (!designSystem) return { ok: false, error: 'not_found' }

  return {
    ok: true,
    ctx: {
      tenantId: tenant.id,
      projectId: newId(),
      tenant: { slug: tenant.slug, name: tenant.name },
      existingClientDocId: existingClientDocId ?? null,
      designSystem,
    },
  }
}
