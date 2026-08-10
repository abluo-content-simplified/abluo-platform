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
 * never send fragments in the request).
 *
 * ROOT CAUSE OF "Invite link invalid or expired" ON A GENUINELY VALID LINK
 * (fixed here): `@supabase/ssr`'s `createBrowserClient` hardcodes
 * `flowType: "pkce"` in its GoTrue options — it is NOT configurable via
 * `src/lib/supabase/client.ts` (the literal is spread in *after*
 * `...options?.auth`, so any override is silently discarded). Admin-issued
 * invite links (`inviteUserByEmail`) are not PKCE links — Supabase's
 * default "Invite user" `ConfirmationURL` redirects with the classic
 * implicit-grant fragment shape (`#access_token=...&refresh_token=...
 * &type=invite`). GoTrue's own `detectSessionInUrl` auto-parse
 * (`_initialize()` → `_getSessionFromURL()`) detects that fragment as an
 * "implicit" callback, compares it against the client's configured
 * `flowType` ('pkce'), finds a mismatch, and throws
 * `AuthPKCEGrantCodeExchangeError` ("Not a valid PKCE flow url") — a throw
 * that `_initialize()` swallows internally (by design: "never throw in
 * this method"). No session is ever set, no error is surfaced anywhere,
 * and `onAuthStateChange` never fires `SIGNED_IN`. This page's old
 * `establishSession()` had no path that would catch that: it waited on
 * `onAuthStateChange` + a 1.5s timeout that could never succeed, then
 * fell through to `invalid`. The link was valid; the client's own
 * built-in URL parser threw away the tokens before this page's code ever
 * ran.
 *
 * THE FIX: read `window.location.hash` directly and call
 * `supabase.auth.setSession({ access_token, refresh_token })` explicitly.
 * `setSession` does not consult `flowType` at all — it accepts any
 * access/refresh token pair — so it is immune to the PKCE/implicit
 * mismatch above regardless of how `detectSessionInUrl` behaves. Because
 * GoTrue's auto-parse throws *before* it clears `window.location.hash`,
 * the tokens are still present in the fragment when this explicit parse
 * runs. This is the PRIMARY path now. The `?code=` and `?token_hash=&
 * type=` query-param shapes are kept as fallbacks (in case a future
 * Supabase link shape or an `/auth/callback` redirect lands here instead),
 * and a short `onAuthStateChange`/timeout wait is kept as a last resort —
 * see `src/app/auth/callback/route.ts` for the server-side counterpart of
 * the query-param paths.
 *
 * TRADEOFF (documented, not implemented): switching the invite email
 * template to a `token_hash`-based link (`{{ .SiteURL }}/auth/callback?
 * token_hash={{ .TokenHash }}&type=invite`) would sidestep the PKCE/
 * implicit mismatch entirely and would also be immune to email-scanner
 * link prefetching consuming a single-use fragment token before the human
 * clicks. It requires a Supabase Dashboard email-template change (a
 * Tom-decision, not made here) and was intentionally not required to fix
 * this bug: explicit `setSession()` from the fragment needs no template
 * change and is deterministic today.
 *
 * ── CROSS-ACCOUNT WRITE HAZARD (fixed here) ──────────────────────────────
 * `createBrowserClient` is a cookie-backed singleton: if the browser
 * already has ANY Supabase session (e.g. the Abluo admin is logged into
 * `/en/dashboard` in the same browser and clicks an invite link sent to
 * someone else — or even their own re-invite), the OLD `establishSession()`
 * called `getSession()` FIRST and, whenever it found an existing session,
 * short-circuited straight to `'ready'` WITHOUT ever looking at the
 * fragment/query tokens on the URL. The admin's session stayed active, and
 * every write later in `handleSubmit()` (`updateUser({ password, data:
 * { full_name } })`, then the `profiles` update) landed on the ADMIN's
 * account, not the invitee's — silently overwriting the admin's name and
 * password with whatever the invitee typed. Confirmed live.
 *
 * THE FIX — the invite link's identity is the ONLY identity this page will
 * ever act on:
 *   1. `establishSession()` now checks the URL for invite credentials
 *      (fragment tokens, `?code=`, or `?token_hash=&type=`) BEFORE it looks
 *      at any existing session at all.
 *   2. If invite credentials are present, it unconditionally calls
 *      `supabase.auth.signOut({ scope: 'local' })` FIRST — dropping any
 *      pre-existing session (admin or otherwise) from this browser — and
 *      only THEN establishes the invitee's session from the link. A
 *      pre-existing session can never survive to short-circuit acceptance
 *      when the URL carries invite credentials.
 *   3. The "already has a session, nothing to do" fast-path now only fires
 *      when the URL carries NO invite credentials at all (e.g. a manual
 *      revisit of this route with a session already in place) — the one
 *      case where reusing an existing session is actually correct.
 *   4. `handleSubmit()` no longer trusts `data.user` from `updateUser()` at
 *      face value for the `profiles` write. It re-fetches
 *      `supabase.auth.getUser()` immediately before the `profiles` update
 *      and uses THAT id. If the two ids ever disagree, or `getUser()` can't
 *      confirm an active user, the write is refused with a visible error
 *      instead of silently landing on an unverified account.
 * Together, (2) makes it structurally impossible for an existing session to
 * still be active when the writes run, and (4) is a second, independent
 * check right before the writes — belt and braces.
 */
type Status =
  | 'checking'
  | 'ready'
  | 'invalid'
  | 'submitting'
  | 'submitError'
  | 'done'
  | 'doneWithWarning'

const MIN_PASSWORD_LENGTH = 8

function parseHashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<Status>('checking')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [profileWarning, setProfileWarning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function establishSession() {
      const hashParams = parseHashParams(window.location.hash)

      // Supabase can put an expired/used-link error either in the query
      // string (the shape /auth/callback appends server-side) or in the
      // fragment (the shape GoTrue's own implicit-grant redirect uses).
      const urlError = searchParams.get('error') || hashParams.get('error')
      if (urlError) {
        if (!cancelled) setStatus('invalid')
        return
      }

      // Read every recognized invite-credential shape from the URL BEFORE
      // touching `getSession()` at all. This ordering is the fix for the
      // cross-account write bug documented in the file-level comment: if
      // an existing (e.g. admin) session were checked first, it would
      // short-circuit acceptance and every later write would land on the
      // wrong account.
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      const code = searchParams.get('code')
      const tokenHash = searchParams.get('token_hash')
      const type = searchParams.get('type') as EmailOtpType | null
      const hasInviteCredentials = Boolean(
        (accessToken && refreshToken) || code || (tokenHash && type)
      )

      if (hasInviteCredentials) {
        // MANDATORY: drop any pre-existing session from this browser
        // (e.g. an Abluo admin logged into the dashboard) before
        // establishing the invitee's session from the link. Without this,
        // `setSession`/`exchangeCodeForSession`/`verifyOtp` below would
        // still succeed, but a lingering client-side reference to the old
        // user could otherwise be reused — and more importantly, skipping
        // this step is exactly what let an existing session survive to
        // short-circuit the flow in the first place. `scope: 'local'`
        // clears only this browser's session (no need to revoke the
        // admin's session everywhere else).
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) {
          // Not fatal — setSession/exchangeCodeForSession/verifyOtp below
          // will still overwrite whatever session is present. Logged for
          // visibility only.
          console.error(
            '[invite/accept] signOut before invite session establishment failed (continuing):',
            signOutError
          )
        }
      }

      // PRIMARY PATH — see the file-level comment above for why this is
      // required rather than relying on the browser client's built-in
      // `detectSessionInUrl` auto-parse. Explicit and deterministic:
      // `setSession` does not care about `flowType`. Because we signed out
      // above, this call always establishes the invitee's session fresh —
      // it can never merge with or be shadowed by a prior session.
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (!error) {
          // Strip tokens from the URL so they don't linger in browser
          // history or get resent as a referrer.
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search
          )
        } else {
          console.error('[invite/accept] setSession from URL fragment failed:', error)
        }
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      // Fallback: query-param shapes, in case this page was reached via
      // /auth/callback after a successful server-side exchange, or a
      // future email-template change routes token_hash/code here.
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) console.error('[invite/accept] exchangeCodeForSession failed:', error)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        if (error) console.error('[invite/accept] verifyOtp failed:', error)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }

      // No invite credentials anywhere in the URL. ONLY in this case is it
      // safe to treat a pre-existing session as "already accepted" — e.g.
      // an SSR cookie carried over from a previous mount of this effect,
      // or the user manually revisiting this route after already
      // completing acceptance. If invite credentials had been present
      // above, this branch never runs — see `hasInviteCredentials`.
      const { data: initial } = await supabase.auth.getSession()
      if (initial.session) {
        if (!cancelled) setStatus('ready')
        return
      }

      // Last resort: no recognized shape found in the URL at all, and no
      // existing session either. Give the browser client's own async
      // initialize() a brief window in case it independently recovers a
      // session (e.g. a future, genuinely PKCE-compatible link shape).
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
    setProfileWarning(null)

    const trimmedName = fullName.trim()
    if (!trimmedName) {
      setFormError('Please enter your name.')
      return
    }
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

    // Sets the password and stores the name in auth metadata
    // (raw_user_meta_data.full_name) in a single GoTrue call — this always
    // succeeds for the user's own account regardless of table-level grants,
    // PROVIDED a session was actually established (bug 1). With bug 1 fixed
    // this call now runs under a real session on every genuinely valid
    // invite link.
    const { data, error } = await supabase.auth.updateUser({
      password,
      data: { full_name: trimmedName },
    })

    if (error) {
      console.error('[invite/accept] updateUser failed:', error)
      setFormError(error.message)
      setStatus('submitError')
      return
    }

    // Verify the metadata write actually landed — updateUser's response
    // reflects the merged user object returned by GoTrue, so this is a
    // real confirmation, not an assumption. (Root cause of the prior
    // "name not persisted" bug was bug 1: with no session, this whole
    // call either errored or ran against a stale/missing user context and
    // was masked by the following profiles update being wrapped in a
    // silent console.warn — see below.)
    const persistedName = data.user?.user_metadata?.full_name
    if (persistedName !== trimmedName) {
      console.error(
        '[invite/accept] updateUser returned success but full_name did not persist in raw_user_meta_data.',
        { expected: trimmedName, got: persistedName, user: data.user }
      )
      setProfileWarning(
        'Your password was set, but we could not confirm your name was saved. You can update it later from your account settings.'
      )
      setStatus('doneWithWarning')
      return
    }

    // SECOND, INDEPENDENT identity check before writing to `profiles`.
    // `data.user` above comes from the `updateUser()` response, which
    // reflects whichever session was active when that call ran. Rather
    // than trust it at face value for a database write, re-fetch the
    // active user directly from GoTrue right before the write and use
    // THAT id. If it doesn't match, or no user can be confirmed at all,
    // refuse the write rather than risk it landing on an unknown account.
    // (`establishSession()` above already makes an existing session
    // impossible to survive when invite credentials are present — this is
    // belt-and-braces, not a substitute for that fix.)
    const { data: freshUserData, error: freshUserError } = await supabase.auth.getUser()
    const freshUserId = freshUserData.user?.id

    if (freshUserError || !freshUserId) {
      console.error('[invite/accept] could not confirm active user before profiles write:', freshUserError)
      setProfileWarning(
        'Your password was set, but we could not confirm your account before saving your name. Please sign in and update your name from your account settings.'
      )
      setStatus('doneWithWarning')
      return
    }

    if (data.user?.id && data.user.id !== freshUserId) {
      // Should be unreachable given the establishSession() fix, but this
      // is exactly the class of bug this whole fix is about — never write
      // on a mismatch, no matter how it could theoretically happen.
      console.error('[invite/accept] identity mismatch between updateUser() and getUser() — refusing profiles write.', {
        updateUserId: data.user.id,
        freshUserId,
      })
      setProfileWarning(
        'Your password was set, but we detected an account mismatch and could not safely save your name. Please sign in and update your name from your account settings.'
      )
      setStatus('doneWithWarning')
      return
    }

    // Mirror into public.profiles.full_name so the row created by
    // handle_new_user() (which only had metadata available at INSERT
    // time, before the invitee had entered a name) picks up the name too.
    // The DB grant + RLS UPDATE policy on profiles are confirmed correct,
    // so with a real session (bug 1, fixed) this should succeed. Errors
    // are surfaced — NOT silently console.warn'd — because the silent
    // swallow is exactly what made this invisible for multiple retries.
    // It still does not block sign-in: the account and password are
    // already valid at this point.
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ full_name: trimmedName })
      .eq('id', freshUserId)

    if (profileError) {
      console.error('[invite/accept] profiles.full_name update failed:', profileError)
      setProfileWarning(
        `Your password was set and your name was saved to your account, but syncing it to your profile failed (${profileError.message}). This does not block sign-in.`
      )
      setStatus('doneWithWarning')
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

  if (status === 'doneWithWarning') {
    return (
      <div>
        <h1 className="mb-2 text-xl font-semibold tracking-tight text-zinc-900">
          Account created
        </h1>
        <p className="mb-8 text-sm text-amber-600">{profileWarning}</p>
        <a
          href="/account"
          className="block w-full rounded bg-zinc-900 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700"
        >
          Continue to account
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
            Your name
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoComplete="name"
            className="w-full rounded border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400"
            placeholder="Jane Doe"
          />
        </div>

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
