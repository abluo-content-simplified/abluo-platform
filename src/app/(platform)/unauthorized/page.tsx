'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Landing page for the admin gate's "authenticated but not an Abluo admin"
 * redirect (ADR-015 R6). Placed at the app root — outside `[locale]` — so it
 * renders at `/unauthorized` with no locale prefix, matching the bare path the
 * proxy redirects to. It is bypassed at the top of `proxy()`, so it is never
 * gated (which would otherwise loop the admin-host / admin-surface redirects).
 *
 * Copy is minimal inline English: this is an admin-only surface (localization
 * exception per the handbook), and — like `src/app/login/page.tsx` — it sits
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm text-center">
        <p className="mb-6 text-xs font-medium tracking-[0.25em] uppercase text-zinc-400">
          Abluo Admin
        </p>
        <h1 className="mb-2 text-xl font-semibold tracking-tight text-zinc-900">
          No access
        </h1>
        <p className="mb-8 text-sm text-zinc-400">
          You don&apos;t have access to this area. If you think this is a
          mistake, sign in with an authorized account.
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
