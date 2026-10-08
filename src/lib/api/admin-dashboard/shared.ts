// Server-only: service-role reads; never import from a client component.
/**
 * Shared reads for the admin providers (ADR-030). Every function here takes
 * the service-role client from a caller that has ALREADY passed
 * `requireAbluoAdmin()` — these helpers never check access themselves and are
 * not exported from the providers' public surface.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllRows, readAllRowsOrThrow } from '@/lib/supabase/read-all'

type Row = Record<string, unknown>

export type AdminOwner = { userId: string; name: string; email: string }

export type AdminProject = {
  id: string
  slug: string
  name: string
  /** draft | preview | active | inactive (a future status stays its stored value). */
  status: string
  customDomain: string | null
  defaultLocale: string
  createdAt: string
  tenantId: string
  /** The client (tenant) the project belongs to. */
  client: { name: string; slug: string } | null
  /** The client's Owners (tenant_members role 'owner'). Empty → nobody can manage the site. */
  owners: AdminOwner[]
}

export const PROJECT_COLUMNS = 'id, slug, name, custom_domain, default_locale, status, created_at, tenant_id, tenants(display_name, slug)'

/** Name (profiles.full_name) and email (auth) per user id. Missing users come back blank. */
export async function readAccounts(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, { name: string; email: string }>> {
  const out = new Map<string, { name: string; email: string }>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return out
  const { rows: profiles } = await readAllRows<Row>((from, to) => admin.from('profiles').select('id, full_name').in('id', unique).order('id').range(from, to))
  const names = new Map(profiles.map((p) => [p.id as string, String(p.full_name ?? '').trim()]))
  await Promise.all(
    unique.map(async (uid) => {
      let email = ''
      try {
        const { data } = await admin.auth.admin.getUserById(uid)
        email = data?.user?.email ?? ''
      } catch {
        /* a missing auth user keeps a blank email */
      }
      out.set(uid, { name: names.get(uid) ?? '', email })
    }),
  )
  return out
}

/** The Owners of each tenant, with name and email. */
export async function readOwnersByTenant(admin: SupabaseClient, tenantIds: readonly string[]): Promise<Map<string, AdminOwner[]>> {
  const out = new Map<string, AdminOwner[]>()
  const unique = [...new Set(tenantIds.filter(Boolean))]
  if (!unique.length) return out
  const rows = await readAllRowsOrThrow<Row>('admin owners', (from, to) =>
    admin.from('tenant_members').select('tenant_id, user_id').eq('role', 'owner').in('tenant_id', unique).order('tenant_id').order('user_id').range(from, to),
  )
  const who = await readAccounts(
    admin,
    rows.map((r) => r.user_id as string),
  )
  for (const r of rows) {
    const uid = r.user_id as string
    const list = out.get(r.tenant_id as string) ?? []
    list.push({ userId: uid, ...(who.get(uid) ?? { name: '', email: '' }) })
    out.set(r.tenant_id as string, list)
  }
  return out
}

/** Pure: a `projects` row (with its `tenants` join) → AdminProject without owners. */
export function mapProjectRow(row: Row): Omit<AdminProject, 'owners'> {
  const t = (Array.isArray(row.tenants) ? row.tenants[0] : row.tenants) as Row | null | undefined
  return {
    id: row.id as string,
    slug: String(row.slug ?? ''),
    name: String(row.name ?? row.slug ?? ''),
    status: String(row.status ?? 'draft'),
    customDomain: typeof row.custom_domain === 'string' && row.custom_domain.trim() ? row.custom_domain.trim() : null,
    defaultLocale: String(row.default_locale ?? ''),
    createdAt: String(row.created_at ?? ''),
    tenantId: String(row.tenant_id ?? ''),
    client: t ? { name: String(t.display_name ?? t.slug ?? ''), slug: String(t.slug ?? '') } : null,
  }
}

export type OpenInvitationRow = {
  id: string
  email: string
  role: string
  scope: 'tenant' | 'project'
  tenantId: string | null
  projectId: string | null
  createdAt: string
  expiresAt: string
}

/** Pure: invitation rows still open (neither accepted nor cancelled). */
export function openInvitations(rows: readonly Row[]): OpenInvitationRow[] {
  return rows
    .filter((r) => !r.accepted_at && !r.revoked_at)
    .map((r) => ({
      id: r.id as string,
      email: String(r.email ?? ''),
      role: String(r.role ?? ''),
      scope: r.scope_type === 'tenant' ? ('tenant' as const) : ('project' as const),
      tenantId: (r.tenant_id as string) ?? null,
      projectId: (r.project_id as string) ?? null,
      createdAt: String(r.created_at ?? ''),
      expiresAt: String(r.expires_at ?? ''),
    }))
}

export const INVITATION_COLUMNS = 'id, email, role, scope_type, tenant_id, project_id, created_at, expires_at, accepted_at, revoked_at'
