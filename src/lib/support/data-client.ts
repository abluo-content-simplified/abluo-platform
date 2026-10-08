// Server-only: may return the service-role client. Never import from a client component.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * The Supabase client for reading / writing ONE project's operational data
 * (contact requests, analytics snapshots) in the client dashboard.
 *
 *   normal person   their own RLS-scoped session — the database decides.
 *   support visit   the service role, because the admin holds no membership
 *                   (ADR-028 §8: staff are never added to a client). Scoped
 *                   strictly to the visited project: any other project id is
 *                   refused here, and every caller has already passed its
 *                   permission check on this context (`assertModuleAction` /
 *                   `can`), which in support mode only grants writes while the
 *                   client's approval is live. Callers keep filtering on
 *                   `project_id = projectId`.
 */
export async function projectDataClient(ctx: TenantAuthorizationContext, projectId: string): Promise<SupabaseClient> {
  if (ctx.support) {
    if (ctx.support.projectId !== projectId) {
      throw new TenantAuthorizationError(`support visit ${ctx.support.sessionId} is scoped to another project — refused`)
    }
    return createAdminClient()
  }
  return (await createClient()) as unknown as SupabaseClient
}
