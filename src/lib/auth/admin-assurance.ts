/**
 * Two-factor gate for Abluo-admin surfaces — the pure half.
 *
 * Every admin surface (Sanity Studio at `/studio`, the admin dashboard, every
 * `requireAbluoAdmin()` API route) now requires the session to be at
 * Supabase Authenticator Assurance Level 2 — i.e. the admin signed in with a
 * password AND completed a TOTP challenge in this session. An `abluo_admin`
 * session at `aal1` is treated as "not yet an admin": it is sent to `/mfa`
 * (pages) or refused (API). Tenant users are unaffected.
 *
 * No I/O and no `next/headers` here, so the same decision is used by
 * `src/proxy.ts` (edge), `src/lib/api/auth.ts` (route handlers / RSC) and the
 * unit tests, and cannot drift between them.
 *
 * ── Where the AAL comes from, and why it is trustworthy ────────────────────
 * `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` decodes the `aal`
 * claim from the session's access token. That token is the one `getUser()`
 * has just sent to the Supabase Auth server and had accepted in the same
 * request (callers MUST call `getUser()` first — `readAssuranceLevel` below
 * documents this), so the claim is server-validated, not merely decoded.
 *
 * ── Fail-closed ─────────────────────────────────────────────────────────────
 * Anything other than the exact string `'aal2'` — `aal1`, null, an error, an
 * unexpected value — is "not two-factor".
 */
import type { PlatformRole } from '@/lib/api/auth'

export type AssuranceLevel = 'aal1' | 'aal2' | null

export type AdminGateDecision =
  /** No valid session → `/login?next=…` (pages) / 403 (API). */
  | 'login'
  /** Authenticated but not `abluo_admin` → `/unauthorized` / 403. */
  | 'unauthorized'
  /** `abluo_admin` at aal1 → `/mfa?next=…` (enroll or challenge) / 403. */
  | 'mfa'
  /** `abluo_admin` at aal2. */
  | 'allow'

export function normalizeAssuranceLevel(value: unknown): AssuranceLevel {
  return value === 'aal2' ? 'aal2' : value === 'aal1' ? 'aal1' : null
}

export function adminGateDecision(input: {
  hasUser: boolean
  platformRole: PlatformRole | null
  currentLevel: AssuranceLevel | string | null | undefined
}): AdminGateDecision {
  if (!input.hasUser) return 'login'
  if (input.platformRole !== 'abluo_admin') return 'unauthorized'
  return normalizeAssuranceLevel(input.currentLevel) === 'aal2' ? 'allow' : 'mfa'
}

/** The structural slice of a Supabase client this module needs. */
export interface AssuranceReader {
  auth: {
    mfa: {
      getAuthenticatorAssuranceLevel(): Promise<{
        data: { currentLevel: string | null } | null
        error: unknown
      }>
    }
  }
}

/**
 * Reads the current session's AAL. Call ONLY after `supabase.auth.getUser()`
 * has returned a user for this same client in this same request (see header).
 * Any error resolves to `null` — fail-closed.
 */
export async function readAssuranceLevel(supabase: AssuranceReader): Promise<AssuranceLevel> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) return null
    return normalizeAssuranceLevel(data.currentLevel)
  } catch {
    return null
  }
}

/**
 * Same-origin relative path or `fallback`. Used for the `next` parameter the
 * MFA page redirects to after a successful challenge — the same rule as
 * `src/app/auth/callback/route.ts` (a leading `//` or `/\` is protocol-
 * relative to a browser, i.e. an open redirect).
 */
export function safeNextPath(next: string | null | undefined, fallback = '/en/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

/** Where the proxy sends an aal1 admin: the MFA page, carrying the original target. */
export function mfaRedirectPath(pathname: string, search = ''): string {
  return `/mfa?next=${encodeURIComponent(safeNextPath(pathname + search))}`
}
