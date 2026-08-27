'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { PasswordInput } from '@/components/ui/PasswordInput'

/**
 * Choose a new password, arriving from a reset email.
 *
 * The session-establishment logic mirrors src/app/invite/accept/page.tsx,
 * deliberately and including its ordering, because the hazard it was written
 * for is sharper here.
 *
 * Supabase delivers the credential in one of three shapes depending on the
 * email template and flow type — a URL fragment carrying access/refresh tokens,
 * a `?code=` for PKCE, or `?token_hash=&type=`. All three are handled, and all
 * of them are read from the URL BEFORE any existing session is considered.
 *
 * The signOut before establishing the link's session is the important part. If
 * an Abluo admin is signed in on this browser and opens a client's reset link,
 * a surviving session would mean updateUser() changes the ADMIN's password
 * instead of the client's — silently, with a success message. `scope: 'local'`
 * clears only this browser.
 */

const MIN_PASSWORD_LENGTH = 8

type Status = 'checking' | 'ready' | 'invalid' | 'done'

function ResetPasswordForm() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function establish() {
      const supabase = createClient()
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const searchParams = new URLSearchParams(window.location.search)

      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type') as EmailOtpType | null

      const hasRecoveryCredentials = Boolean(
        (accessToken && refreshToken) || code || (tokenHash && type)
      )

      if (hasRecoveryCredentials) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) {
          console.error('[reset-password] signOut before session establishment failed:', signOutError)
        }
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        // Strip the tokens so they do not linger in history or leak as a referrer.
        if (!error) {
          window.history.replaceState(null, '', window.location.pathname)
        } else {
          console.error('[reset-password] setSession from URL fragment failed:', error)
        }
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) console.error('[reset-password] exchangeCodeForSession failed:', error)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        if (error) console.error('[reset-password] verifyOtp failed:', error)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      // No credentials in the URL. A session may still exist if the browser
      // client auto-parsed the link, so accept that rather than rejecting
      // someone holding a valid link.
      const { data } = await supabase.auth.getSession()
      if (!cancelled) setStatus(data.session ? 'ready' : 'invalid')
    }

    void establish()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    setStatus('done')
    setSaving(false)
  }

  if (status === 'checking') {
    return (
      <AuthLayout title="Reset your password">
        <p className="text-sm text-zinc-400">Checking your link…</p>
      </AuthLayout>
    )
  }

  if (status === 'invalid') {
    return (
      <AuthLayout
        title="This link has expired"
        subtitle="Reset links are single-use and time-limited."
      >
        <Link
          href="/forgot-password"
          className="inline-block rounded bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Request a new link
        </Link>
      </AuthLayout>
    )
  }

  if (status === 'done') {
    return (
      <AuthLayout title="Password updated" subtitle="You can sign in with your new password.">
        <button
          type="button"
          onClick={() => {
            router.push('/login')
            router.refresh()
          }}
          className="rounded bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Go to sign in
        </button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Choose a new password" subtitle={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <PasswordInput
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder="••••••••"
        />

        <PasswordInput
          label="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          placeholder="••••••••"
        />

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </AuthLayout>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
