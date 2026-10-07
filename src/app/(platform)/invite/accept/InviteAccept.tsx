'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PasswordInput } from '@/components/ui/PasswordInput'
import type { InvitationView } from '@/lib/invitations/service'
import type { InvitationMessages } from '@/lib/invitations/messages'
import { acceptInvitationAction, registerAndAcceptAction } from './actions'

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k] : m))

export function InviteAccept({
  token,
  locale,
  view,
  signedInEmail,
  messages: m,
  minPassword,
}: {
  token: string
  locale: string
  view: InvitationView
  signedInEmail: string | null
  messages: InvitationMessages
  minPassword: number
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const role = view.role ? ((m.roles as Record<string, string>)[view.role] ?? view.role) : ''
  const extras = (view.extras ?? []).map((id) => (m.extras as Record<string, string>)[id] ?? id).join(', ')
  const vars = { place: view.placeName ?? '', role, inviter: view.inviterName ?? '', email: view.email ?? '', min: String(minPassword) }
  const errorText = (code: string): string => {
    const known: Record<string, string> = {
      invalid: m.accept.invalid,
      expired: m.accept.expired,
      revoked: m.accept.revoked,
      used: m.accept.used,
      not_allowed: m.accept.notAllowed,
      wrong_account: m.accept.wrongAccount,
      email_exists: m.accept.emailExists,
      weak_password: m.accept.passwordTooShort,
    }
    return fill(known[code] ?? m.accept.failed, vars)
  }
  const signInHref = `/login?next=${encodeURIComponent(`/invite/accept?token=${token}&lang=${locale}`)}`
  const sameAccount = signedInEmail && view.email && signedInEmail.toLowerCase() === view.email

  async function accept() {
    setBusy(true)
    setError(null)
    const r = await acceptInvitationAction(token, locale)
    if (r.ok) {
      window.location.assign(r.next)
      return
    }
    setError(r.error)
    setBusy(false)
  }

  async function register(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < minPassword) return setError('weak_password')
    if (password !== confirm) return setError('mismatch')
    setBusy(true)
    const r = await registerAndAcceptAction(token, locale, { password, fullName })
    if (!r.ok) {
      setError(r.error)
      setBusy(false)
      return
    }
    // Sign the new account in, then let the server decide the landing (it honours a safe `next`).
    const { error: signInError } = await createClient().auth.signInWithPassword({ email: view.email!, password })
    window.location.assign(signInError ? signInHref : `/auth/continue?next=${encodeURIComponent(r.next)}`)
  }

  async function signOut() {
    setBusy(true)
    await createClient().auth.signOut()
    window.location.reload()
  }

  const input = 'w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400'
  const primary = 'w-full rounded bg-zinc-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50'

  let body: React.ReactNode
  if (view.status !== 'valid') {
    body = <p className="text-sm text-zinc-600">{errorText(view.status)}</p>
  } else if (signedInEmail && sameAccount) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-zinc-500">{fill(m.accept.signedInAs, { email: signedInEmail })}</p>
        <button type="button" onClick={accept} disabled={busy} className={primary}>
          {busy ? m.accept.accepting : m.accept.acceptButton}
        </button>
      </div>
    )
  } else if (signedInEmail) {
    body = (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600">{fill(m.accept.signedInAs, { email: signedInEmail })}</p>
        <p className="text-sm text-zinc-600">{m.accept.wrongAccount}</p>
        <button type="button" onClick={signOut} disabled={busy} className={primary}>
          {m.accept.signOut}
        </button>
      </div>
    )
  } else {
    body = (
      <div className="space-y-6">
        <form onSubmit={register} className="space-y-4">
          <h2 className="text-base font-semibold text-zinc-900">{m.accept.newAccountTitle}</h2>
          <p className="text-sm text-zinc-500">{fill(m.accept.newAccountIntro, vars)}</p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600" htmlFor="invite-name">
              {m.accept.fullName}
            </label>
            <input id="invite-name" className={input} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </div>
          <PasswordInput label={m.accept.password} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={minPassword} autoComplete="new-password" />
          <PasswordInput label={m.accept.passwordConfirm} value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={minPassword} autoComplete="new-password" />
          <button type="submit" disabled={busy} className={primary}>
            {busy ? m.accept.accepting : m.accept.createAndAccept}
          </button>
        </form>
        <p className="text-sm text-zinc-500">
          {m.accept.haveAccount}{' '}
          <a href={signInHref} className="font-medium text-zinc-900 underline">
            {m.accept.signIn}
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-xs font-medium uppercase tracking-[0.25em] text-zinc-400">Abluo</p>
        <h1 className="mb-3 text-xl font-semibold tracking-tight text-zinc-900">{m.accept.title}</h1>
        {view.status === 'valid' && (
          <div className="mb-8 space-y-1 text-sm text-zinc-600">
            <p>{fill(m.accept.invitedTo, vars)}</p>
            <p>{fill(m.accept.invitedBy, vars)}</p>
            {extras && <p>{fill(m.accept.withExtras, { extras })}</p>}
            <p className="text-zinc-400">{fill(m.accept.forEmail, vars)}</p>
          </div>
        )}
        {body}
        {error && (
          <p className="mt-4 text-xs text-red-600" role="alert">
            {error === 'mismatch' ? m.accept.passwordMismatch : errorText(error)}
          </p>
        )}
      </div>
    </div>
  )
}
