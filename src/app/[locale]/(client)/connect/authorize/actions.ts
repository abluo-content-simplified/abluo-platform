'use server'

/**
 * Consent screen actions (ADR-031 D2). Nothing from the form is trusted:
 * `approveConnect` re-validates the partner request, re-checks
 * `connections.manage` on the chosen site and the shared fields. The result is
 * the partner address to send the browser to, or a small error code.
 */
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { approveConnect, denyConnect, sandboxProjectIdsFromEnv, type AuthorizeParams } from '@/lib/connections/consent'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'

export type ConsentActionResult = { ok: true; redirectTo: string } | { ok: false; error: string; redirectTo?: string }

function clean(params: unknown): AuthorizeParams {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null)
  return {
    response_type: s('response_type'),
    client_id: s('client_id'),
    redirect_uri: s('redirect_uri'),
    code_challenge: s('code_challenge'),
    code_challenge_method: s('code_challenge_method'),
    state: s('state'),
    scope: s('scope'),
  }
}

export async function approveConnectAction(input: { params: unknown; projectId: unknown; resources: unknown }): Promise<ConsentActionResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'forbidden' }
  if (typeof input.projectId !== 'string') return { ok: false, error: 'project_not_found' }
  const r = await approveConnect(
    ctx,
    { params: clean(input.params), projectId: input.projectId, resources: input.resources },
    { store: createSupabaseConnectionsStore(), sandboxProjectIds: sandboxProjectIdsFromEnv() },
  )
  return r.ok ? { ok: true, redirectTo: r.redirectTo } : { ok: false, error: r.error, redirectTo: r.redirectTo }
}

export async function denyConnectAction(input: { params: unknown }): Promise<ConsentActionResult> {
  // Declining needs no permission, but it is still a signed-in action.
  if (!(await getTenantAuthorizationContext())) return { ok: false, error: 'forbidden' }
  const r = await denyConnect(clean(input.params), { store: createSupabaseConnectionsStore() })
  return r.redirectTo ? { ok: true, redirectTo: r.redirectTo } : { ok: false, error: 'invalid_client' }
}
