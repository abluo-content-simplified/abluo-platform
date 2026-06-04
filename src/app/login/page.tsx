'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/en/dashboard'

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

    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-600">
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400"
          placeholder="thomas@tmz.it"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-600">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen bg-zinc-50">
      {/* Left accent */}
      <div className="hidden w-52 bg-zinc-950 lg:flex lg:flex-col lg:justify-between lg:px-8 lg:py-10">
        <div>
          <p className="text-xs font-medium tracking-[0.25em] uppercase text-zinc-100">Abluo</p>
          <p className="mt-1 text-[10px] text-zinc-500 tracking-wider">Admin</p>
        </div>
        <p className="text-[10px] text-zinc-700 tracking-widest uppercase">
          Content. Simplified.
        </p>
      </div>

      {/* Login form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <p className="mb-10 text-xs font-medium tracking-[0.25em] uppercase text-zinc-400 lg:hidden">
            Abluo Admin
          </p>
          <h1 className="mb-1 text-xl font-semibold tracking-tight text-zinc-900">
            Sign in
          </h1>
          <p className="mb-8 text-sm text-zinc-400">
            Access the Abluo admin dashboard.
          </p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
