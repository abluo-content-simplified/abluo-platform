// Server-only: service-role reads; never import from a client component.
/**
 * Admin provider — every project on the platform with its client and Owners
 * (ADR-030 Projects list and Home). Reads with the SERVICE ROLE, so it checks
 * `requireAbluoAdmin()` itself first (defence in depth on top of the
 * `(admin)` layout gate). The Owners read is best-effort: a failure leaves
 * `owners` empty and sets `ownersKnown: false`, never the whole list.
 */
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { settle } from '@/lib/api/dashboard/settle'
import { mapProjectRow, PROJECT_COLUMNS, readOwnersByTenant, type AdminProject } from '@/lib/api/admin-dashboard/shared'

export type { AdminOwner, AdminProject } from '@/lib/api/admin-dashboard/shared'

export type AdminProjectsResult = {
  projects: AdminProject[]
  /** False when the Owners read failed: `owners` are then empty for every project, not "no owner". */
  ownersKnown: boolean
  /** Set when the projects read itself failed (the page shows it). */
  error: string | null
}

/** Not an Abluo admin (or no two-step) — the provider read nothing. */
export class AdminAccessError extends Error {
  constructor() {
    super('admin dashboard: Abluo admin with two-step verification required')
    this.name = 'AdminAccessError'
  }
}

/** Throws AdminAccessError unless the current session is an Abluo admin at AAL2. */
export async function assertAbluoAdmin(): Promise<void> {
  if (!(await requireAbluoAdmin())) throw new AdminAccessError()
}

/** For callers that already passed `assertAbluoAdmin()` (same request). */
export async function readAllProjects(): Promise<AdminProjectsResult> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('projects').select(PROJECT_COLUMNS).order('created_at', { ascending: false })
  if (error) return { projects: [], ownersKnown: false, error: error.message }
  const base = ((data ?? []) as Record<string, unknown>[]).map(mapProjectRow)
  const owners = await settle('admin.owners', () => readOwnersByTenant(admin, base.map((p) => p.tenantId)))
  return {
    projects: base.map((p) => ({ ...p, owners: owners?.get(p.tenantId) ?? [] })),
    ownersKnown: owners !== null,
    error: null,
  }
}

export async function listAdminProjects(): Promise<AdminProjectsResult> {
  await assertAbluoAdmin()
  return readAllProjects()
}
