// ── Which Supabase a process is pointed at (ADR-038 D8) ──────────────────────
//
// dev.abluo.app, preview.abluo.app, www.abluo.app, admin.abluo.app and local
// development all share ONE Supabase project (verified 2026-10-20). Anything
// that writes test data — live test suites, migration rehearsals, seed scripts —
// must run against the separate **Abluo Sandbox** project instead, with its
// own credentials in `.env.sandbox.local` (git-ignored, never copied).
//
// This file is the single list of production project refs. A guard that
// recognises production refuses to run; it does not try to be clever.

/** Supabase project refs that hold real tenant data. Never a test target. */
export const PRODUCTION_SUPABASE_REFS: readonly string[] = ['xsdamzirepfqlutvqfbe']

/** The file holding the sandbox project's credentials (repo root, git-ignored by `.env*.local`). */
export const SANDBOX_ENV_FILE = '.env.sandbox.local'

/** `https://<ref>.supabase.co` → `<ref>`; anything else → null. */
export function supabaseRefOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase()
    const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export function isProductionSupabase(url: string | null | undefined): boolean {
  const ref = supabaseRefOf(url)
  return ref !== null && PRODUCTION_SUPABASE_REFS.includes(ref)
}

/**
 * Throws unless `url` is a recognisable Supabase project that is NOT production.
 * Use at the top of every test suite, rehearsal or script that writes.
 */
export function assertSandboxSupabase(url: string | null | undefined, purpose: string): string {
  const ref = supabaseRefOf(url)
  if (!ref) {
    throw new Error(`${purpose}: no sandbox Supabase configured. Put the Abluo Sandbox credentials in ${SANDBOX_ENV_FILE}.`)
  }
  if (PRODUCTION_SUPABASE_REFS.includes(ref)) {
    throw new Error(`${purpose}: refusing to write to the production Supabase project (${ref}). Use the Abluo Sandbox credentials in ${SANDBOX_ENV_FILE}.`)
  }
  return ref
}
