'use server'

/**
 * Invitation acceptance — server actions (ADR-028 §6). The token arrives from
 * the page; the user ALWAYS comes from the validated session (getUser()),
 * never from the request.
 */
import { createClient } from '@/lib/supabase/server'
import { acceptInvitation, registerAndAccept } from '@/lib/invitations/service'
import { invitationLocale } from '@/lib/invitations/messages'

export type AcceptActionResult = { ok: true; next: string } | { ok: false; error: string }

function destination(locale: string, result: { scope: 'tenant' | 'project'; projectSlug?: string }): string {
  const l = invitationLocale(locale)
  return result.scope === 'project' && result.projectSlug ? `/${l}/${result.projectSlug}/home` : `/${l}/sites`
}

export async function acceptInvitationAction(token: string, locale: string): Promise<AcceptActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'signed_out' }
  const result = await acceptInvitation(token, { id: user.id, email: user.email })
  return result.ok ? { ok: true, next: destination(locale, result) } : { ok: false, error: result.error }
}

export async function registerAndAcceptAction(
  token: string,
  locale: string,
  input: { password: string; fullName: string }
): Promise<AcceptActionResult> {
  const result = await registerAndAccept(token, input)
  return result.ok ? { ok: true, next: destination(locale, result) } : { ok: false, error: result.error }
}
