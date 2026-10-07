import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { lookupInvitation, MIN_PASSWORD_LENGTH } from '@/lib/invitations/service'
import { getInvitationMessages, invitationLocale } from '@/lib/invitations/messages'
import { InviteAccept } from './InviteAccept'

/**
 * /invite/accept?token=…&lang=… — ADR-028 §6. One page for everyone:
 * signed in with the invited email → accept; signed in with another account →
 * sign out first; not signed in → create an account (new email) or sign in.
 *
 * Opening the page changes nothing (email scanners prefetch links); only the
 * explicit button calls a server action. The token never leaves this origin:
 * no third-party resources, and no referrer is sent.
 */
export const metadata: Metadata = { title: 'Abluo', referrer: 'no-referrer', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; lang?: string }>
}) {
  const { token = '', lang } = await searchParams
  const locale = invitationLocale(lang)
  const view = await lookupInvitation(token)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <InviteAccept
      token={token}
      locale={locale}
      view={view}
      signedInEmail={user?.email ?? null}
      messages={getInvitationMessages(locale)}
      minPassword={MIN_PASSWORD_LENGTH}
    />
  )
}
