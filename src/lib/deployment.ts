// ─── Deployment Metadata ──────────────────────────────────────────────────────
//
// Single source of truth for all deployment and environment information.
//
// Values are baked in at build time via next.config.ts env block:
//   NEXT_PUBLIC_VERCEL_ENV       — "production" | "preview" | "development"
//   NEXT_PUBLIC_APP_VERSION      — from package.json
//   NEXT_PUBLIC_GIT_COMMIT_SHA   — from VERCEL_GIT_COMMIT_SHA
//   NEXT_PUBLIC_GIT_COMMIT_REF   — from VERCEL_GIT_COMMIT_REF (branch name)
//   NEXT_PUBLIC_BUILD_TIME       — ISO timestamp at build time
//
// Safe to import in server components, client components, footer,
// admin diagnostics, and support screens.
// ─────────────────────────────────────────────────────────────────────────────

export const deployment = {
  env:       process.env.NEXT_PUBLIC_VERCEL_ENV          ?? 'development',
  version:   process.env.NEXT_PUBLIC_APP_VERSION         ?? 'unknown',
  commitSha: (process.env.NEXT_PUBLIC_GIT_COMMIT_SHA     ?? 'local').slice(0, 7),
  branch:    process.env.NEXT_PUBLIC_GIT_COMMIT_REF      ?? 'local',
  buildTime: process.env.NEXT_PUBLIC_BUILD_TIME          ?? '',
} as const

// ─── Environment helpers ───────────────────────────────────────────────────────

/** Vercel production deployment — main branch, custom domains. */
export const isProduction = (): boolean => deployment.env === 'production'

/** Vercel preview deployment (any non-main branch including dev, preview, feature branches). */
export const isPreview = (): boolean => deployment.env === 'preview'

/** Local development. */
export const isDev = (): boolean => deployment.env === 'development'

// ─── Badge label ──────────────────────────────────────────────────────────────
//
// Returns a human-readable environment label for the deployment badge.
// Uses Vercel env as the primary source so feature branches (fix/*, feature/*)
// all display as DEV rather than inventing custom names per branch.
//
//   production                              → null  (badge hidden)
//   preview  + branch === "preview"         → "PREVIEW"
//   everything else (dev, feature branches) → "DEV"
// ─────────────────────────────────────────────────────────────────────────────

export type EnvironmentLabel = 'DEV' | 'PREVIEW'

export const environmentLabel = (): EnvironmentLabel | null => {
  if (isProduction()) return null
  if (deployment.branch === 'preview') return 'PREVIEW'
  return 'DEV'
}
