import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePlatformRole } from '@/lib/api/auth'
import { readAssuranceLevel } from '@/lib/auth/admin-assurance'
import { postLoginDestination } from '@/lib/auth/post-login'
import { routing } from '@/i18n/routing'

/**
 * GET /auth/continue[?next=…] — the post-sign-in landing decision, made on the
 * server from the session cookies this very request carries.
 *
 * The login page (and the invite-accept and MFA pages) hard-navigate here
 * (`window.location.assign`) right after the browser client has written the
 * session cookies. A document navigation always sends them, so there is no
 * second client-side request to race and no client-side role guess. The
 * decision itself is the pure `postLoginDestination()` (unit-tested):
 *   no user → /login · admin at aal1 → /mfa?next=… · admin at aal2 → next or
 *   /<locale>/dashboard · tenant user → next or /<locale>/account.
 *
 * Listed in `isPreAuthSurface()` so the proxy neither gates it nor lets the
 * i18n middleware prefix a locale (there is no `[locale]/auth/continue`).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const platformRole = user ? resolvePlatformRole(user.app_metadata) : null
  // getUser() ran first on this same client, so the decoded aal is
  // server-validated (see admin-assurance.ts). Only an admin pays for it.
  const currentLevel = platformRole === 'abluo_admin' ? await readAssuranceLevel(supabase) : null

  const destination = postLoginDestination({
    hasUser: Boolean(user),
    platformRole,
    currentLevel,
    next: request.nextUrl.searchParams.get('next'),
    cookieLocale: request.cookies.get('NEXT_LOCALE')?.value,
    acceptLanguage: request.headers.get('accept-language'),
    locales: routing.locales,
    defaultLocale: routing.defaultLocale,
  })

  const response = NextResponse.redirect(new URL(destination, request.url), 303)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
