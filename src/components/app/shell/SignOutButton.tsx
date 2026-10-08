'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'

/**
 * Signs the person out and returns them to /login. The ONE sign-out control of
 * the Abluo App (client and admin): the account menu and the Account page render it, styled
 * through `className` (so each keeps its own row look).
 */
export function SignOutButton({ className, onSignOut, icon }: { className?: string; onSignOut?: () => void; icon?: ReactNode }) {
  const t = useTranslations('app.shell')

  async function signOut() {
    onSignOut?.()
    await createClient().auth.signOut()
    // A full navigation to the locale-less /login (src/app/(platform)/(auth)/login): the
    // localized router would go to /{locale}/login, which has no route, and on
    // the admin host the gate would bounce that back with ?next=/en/login.
    // A full load also drops every in-memory trace of the signed-out session.
    window.location.assign('/login')
  }

  return (
    <button type="button" onClick={signOut} className={className}>
      {icon}
      {t('signOut')}
    </button>
  )
}
