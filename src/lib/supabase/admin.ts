import { createClient } from '@supabase/supabase-js'

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
