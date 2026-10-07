/**
 * The signed-in person's own account, for the account menu and the Account page:
 * name, email, picture and whether 2-step verification is on. Server-only.
 *
 * Everything is read AS the user (their session, RLS: own `profiles` row, own
 * MFA factors) — no service role. Failure never breaks the page: every field
 * degrades to blank / unknown, so the shell still renders.
 *
 * People (ADR-028) reads the same facts about OTHER people with the service
 * role (`people/service.ts`); the avatar rule is shared via `safeAvatarUrl`.
 */
import { createClient } from '@/lib/supabase/server'
import { safeAvatarUrl } from '@/lib/people/service'

export type ViewerAccount = {
  /** Full name, or '' when the person has none yet. */
  name: string
  email: string
  /** Abluo-hosted picture only (see safeAvatarUrl). */
  avatarUrl: string | null
  /** True/false when known, null when it could not be read. */
  twoFactor: boolean | null
}

type FactorList = { data: { totp?: { status?: string }[]; all?: { status?: string }[] } | null }

export async function getViewerAccount(userId: string): Promise<ViewerAccount> {
  const blank: ViewerAccount = { name: '', email: '', avatarUrl: null, twoFactor: null }
  try {
    const supabase = await createClient()
    const [{ data: profile }, { data: auth }, factors] = await Promise.all([
      supabase.from('profiles').select('full_name, avatar_url').eq('id', userId).maybeSingle(),
      supabase.auth.getUser(),
      (supabase.auth.mfa.listFactors() as Promise<FactorList>).catch(() => null),
    ])
    const meta = auth.user?.user_metadata as { full_name?: unknown } | undefined
    const name = [profile?.full_name, meta?.full_name].find((n): n is string => typeof n === 'string' && n.trim() !== '')
    const list = factors?.data?.all ?? factors?.data?.totp
    return {
      name: name?.trim() ?? '',
      email: auth.user?.email ?? '',
      avatarUrl: safeAvatarUrl(profile?.avatar_url),
      twoFactor: list ? list.some((f) => f.status === 'verified') : null,
    }
  } catch {
    return blank
  }
}
