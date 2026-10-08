'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthError, AuthField, AuthNote, authPrimaryClass, authQuietLinkClass, authSecondaryClass } from '@/components/auth/auth-ui'

/**
 * Request a password reset.
 *
 * Always reports the same thing, whether or not the address has an account.
 * Saying "no account with that email" turns this form into a way to discover
 * who has access to the platform, which for a multi-tenant product means
 * discovering a client list.
 *
 * The redirect target is derived from window.location.origin rather than an
 * env var so a reset started on dev, preview or production comes back to the
 * same place — all three share one Supabase project, and a hardcoded URL would
 * send everyone to whichever environment it named. The Supabase project's
 * Redirect URLs allowlist still has to contain each origin.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    // A rate-limit response is worth surfacing — otherwise someone who clicks
    // twice sits waiting for an email that was never sent. Anything else is
    // swallowed deliberately, so the response cannot be used to probe for
    // registered addresses.
    if (error && error.status === 429) {
      setError('Too many requests. Wait a minute and try again.')
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email" subtitle={`If an account exists for ${email}, a reset link is on its way.`}>
        <AuthNote>
          The link expires after a short time. If it does not arrive, check your spam folder,
          then request another.
        </AuthNote>
        <Link href="/login" className={`${authSecondaryClass} mt-6`}>
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <form onSubmit={handleSubmit} className="space-y-5">
        <AuthField
          id="forgot-email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="you@example.com"
        />

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} aria-busy={loading || undefined} className={authPrimaryClass}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <div className="flex justify-center">
          <Link href="/login" className={authQuietLinkClass}>
            Back to sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  )
}
