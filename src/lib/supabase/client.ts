import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side Supabase client.
 * Use in Client Components only.
 * Uses the anon key — subject to RLS policies.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
