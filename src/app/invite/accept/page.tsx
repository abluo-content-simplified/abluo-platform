'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * /invite/accept — completes an ADR-017 slice 4 invite and sets the
 * invited user's password.
 *
 * English-only for this slice — the tenant client interface is a later
 * multilingual effort (localize with the client interface, slice 6). This
 * page sits outside `[locale]`, matching `/login` and `/unauthorized`.
 *
 * Both invite routes (`/api/tenants/[tenantId]/invite`,
 * `/api/projects/[projectId]/invite`) set `redirectTo` to this route
 * directly (not `/auth/callback`) because Supabase's default "Invite user"
 * email template redirects with session tokens in the URL FRAGMENT
 * (`#access_token=...&refresh_token=...&type=invite`), which only a
 * browser-executed page can read — a server route never sees it (browsers
 * never send fragments in the request). The Supabase browser client
 * (`@supabase/ssr`'s `createBrowserClient`, default `detectSessionInUrl:
 * true`) auto-parses that fragment on initialization and persists the
 * session to cookies (kept in sync with SSR reads, same as any other
 * `createClient()` browser session).
 *
 * This page additionally handles the query-param shapes defensively
 * (`?code=`, `?token_hash=&type=`) in case a session hasn't already been
 * established by the time this component mounts, and the `?error=` /
 * `?error_description=` shape Supabase appends for an expired/used link —
 * see `src/app/auth/callback/route.ts` for the server-side counterpart of
 * the query-param paths.
 */
type Status = 'checking' | 'ready' | 'invalid' | 'submitting' | 'submitError' | 'done'

const MIN_PASSWORD_LENGTH = 8

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function establishSession() {
      const urlError = searchParams.get('error')
      if (urlError) {
        if (!cancelled) setStatus('invalid')
        return
      }

      // Already has a session (e.g. detectSessionInUrl already ran, or the
      // user landed here via /auth/callback after a successful exchange).
      const { data: initial } = await supabase.auth.getSession()
      if (initial.session) {
        if (!cancelled) setStatus('ready')
        return
      }

      // Defensive: handle query-param shapes directly, in case this page
      // was reached without going through /auth/callback.
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type') as EmailOtpType | null

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      // Neither a pre-existing session nor recognized params — give
      // detectSessionInUrl a brief window to finish parsing a fragment
      // (#access_token=...) before concluding the link is invalid.
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return
        if (event === 'SIGNED_IN' && session) {
          setStatus('ready')
        }
      })

      const timeout = setTimeout(async () => {
        if (cancelled) return
        const { data: recheck } = await supabase.auth.getSession()
        setStatus(recheck.session ? 'ready' : 'invalid')
      }, 1500)

      return () => {
        clearTimeout(timeout)
        subscription.unsubscribe()
      }
    }

    const cleanupPromise = establishSession()
    return () => {
      cancelled = true
      cleanupPromise.then((cleanup) => cleanup?.())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }

    setStatus('submitting')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setFormError(error.message)
      setStatus('submitError')
      return
    }

    setStatus('done')
    router.push('/account')
    router.refresh()
  }

  if (status === 'checking') {
    return <p className="text-sm text-zinc-400">Verifying your invite…</p>
  }

  if (status === 'invalid') {
    return (
      <div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight text-zinc-900">
          Invite link invalid or expired
        </h1>
        <p className="mb-8 text-sm text-zinc-400">
          This invite link is no longer valid — it may have already been
          used or has expired. Ask whoever invited you to send a new one, or
          sign in if you already set your password.
        </p>
        <a
          href="/login"
          className="block w-full rounded bg-zinc-900 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Go to sign in
        </a>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900">
        Set your password
      </h1>
      <p className="mb-8 text-sm text-zinc-400">
        Choose a password to finish setting up your account.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600">
            Confirm password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            className="w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400"
            placeholder="••••••••"
          />
        </div>

        {formError && <p className="text-xs text-red-500">{formError}</p>}

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {status === 'submitting' ? 'Setting password…' : 'Set password and continue'}
        </button>
      </form>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-xs font-medium tracking-[0.25em] uppercase text-zinc-400">
          Abluo
        </p>
        <Suspense fallback={<p className="text-sm text-zinc-400">Loading…</p>}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </div>
  )
}
