'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Signs the person out and returns them to /login. The ONE sign-out control of
 * the client app: the account menu and the Account page both render it, styled
 * through `className` (so each keeps its own row look).
 */
export function SignOutButton({ className, onSignOut }: { className?: string; onSignOut?: () => void }) {
  const t = useTranslations('clientDashboard.shell')
  const router = useRouter()

  async function signOut() {
    onSignOut?.()
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button type="button" onClick={signOut} className={className}>
      {t('signOut')}
    </button>
  )
}
