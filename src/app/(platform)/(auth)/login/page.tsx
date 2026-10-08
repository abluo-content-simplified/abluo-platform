'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthError, AuthField, AuthPasswordInput, authPrimaryClass, authQuietLinkClass } from '@/components/auth/auth-ui'

function LoginForm() {
  const searchParams = useSearchParams()
  const explicitNext = searchParams.get('next')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Where to land is decided SERVER-side by GET /auth/continue (see
    // src/lib/auth/post-login.ts): admin → MFA challenge or dashboard, tenant
    // user → their localized account page, an explicit safe `?next=` honored.
    //
    // This used to be decided here — `fetch('/api/auth/me')`, then
    // `router.push()` — and on preview v1.0.42 that sent a TOTP admin to a
    // bare `/account` (no route → 404) whenever the role fetch answered
    // `null`. A FULL navigation is deliberate: the document request carries
    // the session cookies the browser client has just written, the target is
    // in a different root layout anyway (`(platform)` → `[locale]`), and the
    // proxy/gates see exactly what the server will.
    const target = explicitNext
      ? `/auth/continue?next=${encodeURIComponent(explicitNext)}`
      : '/auth/continue'
    window.location.assign(target)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <AuthField
        id="login-email"
        label="Email"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        autoComplete="email"
        placeholder="you@example.com"
      />

      <div>
        <AuthPasswordInput
          label="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="••••••••"
        />
        <div className="mt-2 flex justify-end">
          <Link href="/forgot-password" className={authQuietLinkClass}>
            Forgot your password?
          </Link>
        </div>
      </div>

      {error && <AuthError>{error}</AuthError>}

      <button type="submit" disabled={loading} aria-busy={loading || undefined} className={authPrimaryClass}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <AuthLayout title="Sign in" subtitle="Access the Abluo admin dashboard.">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  )
}
