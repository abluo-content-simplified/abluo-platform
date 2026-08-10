import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side admin Supabase client.
 * Uses the service role key — BYPASSES RLS.
 *
 * Use ONLY in:
 * - Server Actions that require elevated access
 * - Background jobs / seeding scripts
 * - JWT claim setup
 *
 * NEVER expose this client to the browser.
 *
 * Prefer `runAsTrustedSystemOperation()` below at any NEW call site — it
 * makes the service-role footprint grep-auditable. This raw export stays
 * for the admin-surface routes (dashboard reads, /api/sanity/{tenant,
 * tenants,projects}) that are a deliberately separate, later hardening
 * phase (ADR-017 slice 5 handoff §10) — not touched by this change.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

/**
 * Thin, grep-auditable wrapper around `createAdminClient()` (ADR-015 —
 * "make the service-role footprint auditable"). Every legitimately-
 * privileged service-role call site should go through this instead of
 * calling `createAdminClient()` directly, so `grep -rn
 * runAsTrustedSystemOperation src` gives a complete, self-documenting
 * inventory of every place the platform intentionally bypasses RLS, with
 * the reason recorded right next to the call.
 *
 * Zero behavior change versus a bare `createAdminClient()` call — this is
 * an audit-trail wrapper, not a new authorization mechanism. `reason` is
 * required and must be a non-trivial, specific justification (not "admin
 * stuff") — enforced at runtime so a lazy/empty reason fails loudly in dev
 * rather than silently documenting nothing.
 *
 * Deliberately NOT used by the admin-surface routes (dashboard reads,
 * `/api/sanity/{tenant,tenants,projects}`) — those are a separate,
 * later hardening phase (flip to `abluo_admin`-gated + non-service-role
 * reads), out of this change's scope. See the handoff for the current
 * inventory of wrapped vs. not-yet-wrapped service-role call sites.
 */
export async function runAsTrustedSystemOperation<T>(
  reason: string,
  fn: (supabase: SupabaseClient) => Promise<T>
): Promise<T> {
  if (!reason || reason.trim().length < 10) {
    throw new Error(
      'runAsTrustedSystemOperation requires a specific, non-empty justification string ' +
        '(at least 10 characters) — this is the audit trail for every service-role ' +
        '(RLS-bypassing) database operation on the platform.'
    )
  }
  const supabase = createAdminClient()
  return fn(supabase)
}
