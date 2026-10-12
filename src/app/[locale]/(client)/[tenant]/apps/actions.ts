'use server'

/**
 * Client dashboard — Connected apps actions (ADR-031). Every action re-resolves
 * the caller's grants server-side and re-validates the URL project; manage.ts
 * then checks `connections.manage` on the connection's OWN project and refuses
 * support mode. A connection id from another site answers `not_found`.
 */
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { pauseConnection, resumeConnection, revokeConnection, type ManageResult } from '@/lib/connections/manage'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'

export type ConnectionActionResult = { ok: true } | { ok: false; error: string }

type Input = { projectSlug: string; locale: string; connectionId: string }

async function run(input: Input, fn: typeof pauseConnection | typeof resumeConnection | typeof revokeConnection): Promise<ConnectionActionResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'forbidden' }
  const grant = resolveProjectGrant(ctx.projects, input.projectSlug)
  if (!grant || typeof input.connectionId !== 'string') return { ok: false, error: 'forbidden' }
  const store = createSupabaseConnectionsStore()
  // The connection must belong to the site in the URL (not just any site the caller manages).
  const row = await store.getConnection(input.connectionId)
  if (!row || row.project_id !== grant.projectId) return { ok: false, error: 'not_found' }
  const r: ManageResult = await fn(ctx, input.connectionId, { store })
  if (!r.ok) return r
  // No revalidatePath: the screen calls router.refresh() itself — doing both
  // rendered the page twice and made every action feel slow.
  return { ok: true }
}

export async function pauseConnectionAction(input: Input) {
  return run(input, pauseConnection)
}
export async function resumeConnectionAction(input: Input) {
  return run(input, resumeConnection)
}
export async function disconnectConnectionAction(input: Input) {
  return run(input, revokeConnection)
}
