'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthLayout } from '@/components/auth/AuthLayout'

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
        <p className="text-xs text-zinc-400">
          The link expires after a short time. If it does not arrive, check your spam folder,
          then request another.
        </p>
        <Link
          href="/login"
          className="mt-6 block text-[11px] text-zinc-400 transition-colors hover:text-zinc-600"
        >
          Back to sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400"
            placeholder="you@example.com"
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <Link
          href="/login"
          className="block text-center text-[11px] text-zinc-400 transition-colors hover:text-zinc-600"
        >
          Back to sign in
        </Link>
      </form>
    </AuthLayout>
  )
}
