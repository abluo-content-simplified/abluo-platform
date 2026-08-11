/**
 * App environment helper — ADR-019.
 *
 * Vercel exposes VERCEL_ENV = 'production' | 'preview' | 'development'.
 * dev.abluo.app and preview.abluo.app are BOTH Vercel "preview" deployments,
 * so both tag as 'preview'; only main/abluo.app tags 'production'. That is
 * exactly the gate we want — only production delivers notifications.
 */
export type AppEnvironment = 'production' | 'preview' | 'development'

export function getAppEnvironment(): AppEnvironment {
  const v = process.env.VERCEL_ENV
  if (v === 'production' || v === 'preview' || v === 'development') return v
  return 'development'
}

/** Only production events are delivered. Null/unknown → non-production (fail safe). */
export function isProductionEnvironment(env: string | null | undefined): boolean {
  return env === 'production'
}
