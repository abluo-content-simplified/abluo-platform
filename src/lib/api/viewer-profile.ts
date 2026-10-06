/**
 * The signed-in person's first name, for greetings ("Good morning, Paolo",
 * "Hi Paolo, …"). Read from their own `profiles.full_name` row (RLS: a user
 * reads their own profile), falling back to the name GoTrue keeps in the
 * user's metadata (set together with the password on /invite/accept). Null
 * when neither has one — callers then greet without a name.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { createClient } from '@/lib/supabase/server'

type ProfileReader = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
  auth: { getUser: () => Promise<{ data: { user: { user_metadata?: Record<string, unknown> | null } | null } }> }
}

/** "Paolo Martegani" → "Paolo"; blank → null. */
export function firstNameOf(fullName: unknown): string | null {
  if (typeof fullName !== 'string') return null
  const first = fullName.trim().split(/\s+/)[0]
  return first ? first.slice(0, 40) : null
}

export async function getViewerFirstName(ctx: TenantAuthorizationContext, deps: { client?: ProfileReader } = {}): Promise<string | null> {
  try {
    const supabase = deps.client ?? ((await createClient()) as unknown as ProfileReader)
    const { data } = await supabase.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle()
    const fromProfile = firstNameOf((data as { full_name?: unknown } | null)?.full_name)
    if (fromProfile) return fromProfile
    const { data: auth } = await supabase.auth.getUser()
    return firstNameOf(auth.user?.user_metadata?.full_name)
  } catch {
    return null
  }
}
