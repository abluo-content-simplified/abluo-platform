'use client'

/**
 * Two-factor (TOTP) enrollment and challenge for Abluo admins.
 *
 * The admin gate (`src/proxy.ts`, `requireAbluoAdmin`, the admin layout) sends
 * an `abluo_admin` whose session is only at AAL1 here, with `?next=` set to
 * where they were going. This page:
 *   - with no session            → /login?next=/mfa…
 *   - with a verified TOTP factor → asks for the 6-digit code (challenge)
 *   - with none yet               → enrolls one: QR code + manual secret, then
 *                                   verifies the first code
 * A successful verify upgrades THIS session to AAL2 (Supabase rewrites the
 * session cookies), and we hard-navigate to `next` so the proxy sees it.
 *
 * Recovery (lost authenticator): in the Supabase dashboard → Authentication →
 * Users → the admin → delete the TOTP factor. The next sign-in lands here in
 * enrollment mode. See docs/engineering/admin-two-factor.md.
 *
 * Copy is English: this is an admin-only surface, which CLAUDE.md lists as an
 * exception to the no-hardcoded-strings rule (like /login). It is kept in one
 * object so it can move to a dictionary unchanged if that ever changes.
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/auth/admin-assurance'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthError, AuthField, AuthNote, authPrimaryClass, authQuietLinkClass } from '@/components/auth/auth-ui'

const COPY = {
  title: 'Two-factor authentication',
  challengeIntro: 'Enter the 6-digit code from your authenticator app.',
  enrollIntro:
    'Admin access requires two-factor authentication. Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the 6-digit code it shows.',
  manualSecret: 'Can’t scan? Enter this key manually:',
  codeLabel: 'Authentication code',
  verify: 'Verify',
  verifying: 'Verifying…',
  loading: 'Loading…',
  signOut: 'Sign out',
  genericError: 'Something went wrong. Please try again.',
} as const

const FRIENDLY_NAME = 'Abluo admin'

type Mode =
  | { kind: 'loading' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enroll'; factorId: string; qrCode: string; secret: string }
  | { kind: 'error'; message: string }

function MfaForm() {
  const searchParams = useSearchParams()
  const next = safeNextPath(searchParams.get('next'))
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const prepare = useCallback(async () => {
    const supabase = createClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) {
      window.location.assign(`/login?next=${encodeURIComponent(`/mfa?next=${encodeURIComponent(next)}`)}`)
      return
    }

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.currentLevel === 'aal2') {
      window.location.assign(next)
      return
    }

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError || !factors) {
      setMode({ kind: 'error', message: listError?.message ?? COPY.genericError })
      return
    }

    const totp = factors.all.filter((f) => f.factor_type === 'totp')
    const verified = totp.find((f) => f.status === 'verified')
    if (verified) {
      setMode({ kind: 'challenge', factorId: verified.id })
      return
    }

    // An abandoned enrollment leaves an unverified factor behind, and a second
    // enroll with the same friendly name is rejected — clear them first.
    for (const f of totp) await supabase.auth.mfa.unenroll({ factorId: f.id })

    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: FRIENDLY_NAME,
    })
    if (enrollError || !enrolled) {
      setMode({ kind: 'error', message: enrollError?.message ?? COPY.genericError })
      return
    }
    setMode({
      kind: 'enroll',
      factorId: enrolled.id,
      qrCode: enrolled.totp.qr_code,
      secret: enrolled.totp.secret,
    })
  }, [next])

  useEffect(() => {
    void prepare()
  }, [prepare])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (mode.kind !== 'challenge' && mode.kind !== 'enroll') return
    setError(null)
    setBusy(true)
    const supabase = createClient()
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mode.factorId,
      code: code.trim(),
    })
    if (verifyError) {
      setError(verifyError.message)
      setBusy(false)
      return
    }
    // Hard navigation: the proxy must read the upgraded (AAL2) cookies.
    window.location.assign(next)
  }

  async function handleSignOut() {
    await createClient().auth.signOut()
    window.location.assign('/login')
  }

  if (mode.kind === 'loading') return <AuthNote>{COPY.loading}</AuthNote>
  if (mode.kind === 'error') return <AuthError>{mode.message}</AuthError>

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <AuthNote>{mode.kind === 'enroll' ? COPY.enrollIntro : COPY.challengeIntro}</AuthNote>

      {mode.kind === 'enroll' && (
        <div className="space-y-4">
          {/* Supabase returns the QR code as an SVG data URL. It sits on a
              light plate in both themes: dark modules on a dark card do not
              scan. `--card` of the light App palette, by design not themed. */}
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mode.qrCode}
              alt=""
              width={180}
              height={180}
              className="rounded-xl border border-border p-2"
              style={{ backgroundColor: 'oklch(1 0 0)' }}
            />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{COPY.manualSecret}</p>
            <code className="mt-1.5 block rounded-lg bg-muted px-3 py-2 font-mono text-sm break-all text-foreground">{mode.secret}</code>
          </div>
        </div>
      )}

      <AuthField
        id="mfa-code"
        label={COPY.codeLabel}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="text-center text-lg tracking-[0.4em] tabular-nums"
      />

      {error && <AuthError>{error}</AuthError>}

      <button type="submit" disabled={busy || code.length !== 6} aria-busy={busy || undefined} className={authPrimaryClass}>
        {busy ? COPY.verifying : COPY.verify}
      </button>

      <div className="flex justify-center">
        <button type="button" onClick={handleSignOut} className={authQuietLinkClass}>
          {COPY.signOut}
        </button>
      </div>
    </form>
  )
}

export default function MfaPage() {
  return (
    <AuthLayout title={COPY.title}>
      <Suspense fallback={null}>
        <MfaForm />
      </Suspense>
    </AuthLayout>
  )
}
