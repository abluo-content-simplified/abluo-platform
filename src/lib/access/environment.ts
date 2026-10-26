/**
 * Site Access — which environment a visitor session belongs to (B2.0).
 *
 * dev, preview and production share one Supabase project, so a session row
 * written on dev.abluo.app would otherwise be a valid production session. Each
 * session is therefore bound to the environment that created it and resolved
 * only there (migration 050, `site_access_sessions.environment`).
 *
 *   on Vercel, VERCEL_ENV=production                     → 'production'
 *   on Vercel, VERCEL_ENV=preview, branch `preview`      → 'preview'
 *   on Vercel, VERCEL_ENV=preview, any other branch      → 'dev'   (dev + feature branches)
 *   on Vercel, VERCEL_ENV=development                    → 'local' (`vercel dev`)
 *   not on Vercel (VERCEL unset)                         → 'local'
 *   on Vercel with VERCEL_ENV missing or unknown         → null    → fail closed
 *
 * The same tiers as the deployment badge (src/lib/deployment.ts: DEV vs
 * PREVIEW). Read from the RUNTIME variables Vercel sets, not from the
 * NEXT_PUBLIC_* copies baked at build time, which default to 'development'
 * when missing — a silent default is exactly what must not decide this.
 */
export const ACCESS_ENVIRONMENTS = ['production', 'preview', 'dev', 'local'] as const
export type AccessEnvironment = (typeof ACCESS_ENVIRONMENTS)[number]

export function isAccessEnvironment(value: unknown): value is AccessEnvironment {
  return typeof value === 'string' && (ACCESS_ENVIRONMENTS as readonly string[]).includes(value)
}

type Env = Record<string, string | undefined>

export function resolveAccessEnvironment(env: Env = process.env): AccessEnvironment | null {
  const onVercel = env.VERCEL === '1' || env.VERCEL === 'true'
  if (!onVercel) return 'local'
  switch (env.VERCEL_ENV) {
    case 'production':
      return 'production'
    case 'preview': {
      const branch = env.VERCEL_GIT_COMMIT_REF
      if (!branch) return null
      return branch === 'preview' ? 'preview' : 'dev'
    }
    case 'development':
      return 'local'
    default:
      return null
  }
}
