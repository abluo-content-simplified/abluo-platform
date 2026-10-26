/**
 * Site Access — server wiring (ADR-040). The only place this module touches
 * the service-role client or the environment.
 *
 * VERCEL / VERCEL_ENV / VERCEL_GIT_COMMIT_REF (set by Vercel at runtime) pick
 * the session environment.
 *
 * ACCESS_IP_SALT (required, server-only, Vercel env + .env.local): salts the
 * rate-limit IP hashes. Missing → every password attempt answers
 * `unavailable` (fail closed); resolving existing sessions still works.
 * No other secret exists: session tokens are opaque random values whose hash
 * is stored, so there is nothing to sign.
 */
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { resolveAccessEnvironment, type AccessEnvironment } from './environment'
import { createSupabaseSiteAccessStore, type SiteAccessStore } from './store'
import { createSupabaseSiteAccessFiles, type SiteAccessFiles } from './file-storage'

/**
 * The environment visitor sessions are bound to (see environment.ts). null on
 * Vercel when it cannot be determined: unlock then answers `unavailable` and
 * no session resolves — fail closed, never a guess.
 */
export function accessEnvironment(): AccessEnvironment | null {
  return resolveAccessEnvironment(process.env)
}

export function accessIpSalt(): string | undefined {
  const v = process.env.ACCESS_IP_SALT
  return v && v.length >= 16 ? v : undefined
}

/**
 * Runs `fn` with a service-role-backed store. `reason` is recorded next to the
 * call site (ADR-015 service-role inventory) — say which route and why.
 */
export function withSiteAccessStore<T>(reason: string, fn: (store: SiteAccessStore, files: SiteAccessFiles) => Promise<T>): Promise<T> {
  return runAsTrustedSystemOperation(`site-access: ${reason}`, (db) => fn(createSupabaseSiteAccessStore(db), createSupabaseSiteAccessFiles(db)))
}
