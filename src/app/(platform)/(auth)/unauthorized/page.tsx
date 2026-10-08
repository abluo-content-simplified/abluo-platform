'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { authPrimaryClass } from '@/components/auth/auth-ui'

/**
 * Landing page for the admin gate's "authenticated but not an Abluo admin"
 * redirect (ADR-015 R6). Placed at the app root — outside `[locale]` — so it
 * renders at `/unauthorized` with no locale prefix, matching the bare path the
 * proxy redirects to. It is bypassed at the top of `proxy()`, so it is never
 * gated (which would otherwise loop the admin-host / admin-surface redirects).
 *
 * Copy is minimal inline English: this is an admin-only surface (localization
 * exception per the handbook), and — like `src/app/(platform)/(auth)/login/page.tsx` — it sits
 * outside the `[locale]` next-intl provider, so it has no message context to
 * read from.
 */
export default function UnauthorizedPage() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <AuthLayout
      title="No access"
      subtitle="You don't have access to this area. If you think this is a mistake, sign in with an authorized account."
    >
      <button type="button" onClick={handleSignOut} className={authPrimaryClass}>
        Sign out
      </button>
    </AuthLayout>
  )
}
