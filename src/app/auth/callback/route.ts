import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /auth/callback — server-side session establishment for Supabase email
 * link flows (ADR-017 slice 4, invite-acceptance leg).
 *
 * Handles the two QUERY-PARAM-based link shapes Supabase can produce:
 *
 * 1. PKCE code exchange — `?code=...` — `exchangeCodeForSession(code)`.
 *    Only works when the code_verifier cookie from the flow's initiator is
 *    present, i.e. same browser that started the flow. Invites are opened
 *    by a *different* person than whoever called `inviteUserByEmail`, so
 *    this path realistically never fires for invite links — it's handled
 *    here defensively in case Supabase's link shape changes, or for other
 *    same-browser flows that might route through this callback later.
 * 2. Token-hash OTP verification — `?token_hash=...&type=...` —
 *    `verifyOtp({ type, token_hash })`. This is Supabase's documented
 *    SSR-safe pattern for email flows (invite/magiclink/recovery/etc.) and
 *    works across browsers/devices because verification happens against
 *    the token itself, not a locally-stored code_verifier. This is the path
 *    Tom should route to if he customizes the "Invite user" email template
 *    to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/invite/accept`
 *    (see handoff §8) instead of the default `{{ .ConfirmationURL }}`.
 *
 * NOT handled here: Supabase's *default* "Invite user" template
 * (`{{ .ConfirmationURL }}`) redirects with session tokens in the URL
 * FRAGMENT (`#access_token=...&refresh_token=...`), which browsers never
 * send to the server — a server route physically cannot see it. That shape
 * is handled entirely client-side by `/invite/accept` via the Supabase
 * browser client's `detectSessionInUrl` auto-parsing. This route is the
 * secondary/optional path; `/invite/accept` is the one both invite API
 * routes actually redirect to (see their `redirectTo`).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const next = searchParams.get('next') ?? '/invite/accept'

  if (error) {
    const url = new URL('/invite/accept', origin)
    url.searchParams.set('error', errorDescription ?? error)
    return NextResponse.redirect(url)
  }

  const supabase = await createClient()

  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      return NextResponse.redirect(new URL(next, origin))
    }
  } else if (tokenHash && type) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!verifyError) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  // No recognized params, or the exchange/verify call itself failed
  // (expired/used token, malformed code, etc.) — land on the acceptance
  // page's error state rather than silently redirecting into a page that
  // will just look broken with no session.
  const url = new URL('/invite/accept', origin)
  url.searchParams.set('error', 'invalid_or_expired')
  return NextResponse.redirect(url)
}
