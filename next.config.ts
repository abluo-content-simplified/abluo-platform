import type { NextConfig } from 'next'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Resolve the latest git tag at build time (used as a fallback only).
// Falls back gracefully if git is unavailable (e.g. shallow clone without tags).
let gitRelease = 'unknown'
try {
  gitRelease = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' }).trim()
} catch {
  // No tags found or git unavailable — leave as 'unknown'
}

// release.json is the authoritative version SSOT (Release Automation 1.2).
// Read the two version axes at build time and bake them into the bundle.
//   platformVersion    — customer-facing milestone (e.g. V1.0.0)
//   engineeringVersion — developer-facing iteration (e.g. V1.0.0.1)
let platformVersion = 'unknown'
let engineeringVersion = gitRelease
let releaseName = ''
try {
  const release = JSON.parse(readFileSync(resolve(process.cwd(), 'release.json'), 'utf-8'))
  platformVersion = release.platformVersion ?? platformVersion
  engineeringVersion = release.engineeringVersion ?? engineeringVersion
  releaseName = release.releaseName ?? ''
} catch {
  // No release.json — fall back to the git tag for the engineering version.
}

// All domain-based routing is handled in proxy.ts (middleware).
const nextConfig: NextConfig = {
  // ── Build-time deployment metadata ─────────────────────────────────────────
  // Baked in at build time so client components can read them as NEXT_PUBLIC_*
  // without exposing server-only VERCEL_* variables.
  env: {
    NEXT_PUBLIC_VERCEL_ENV:           process.env.VERCEL_ENV            ?? 'development',
    NEXT_PUBLIC_GIT_RELEASE:          gitRelease,
    NEXT_PUBLIC_PLATFORM_VERSION:     platformVersion,
    NEXT_PUBLIC_ENGINEERING_VERSION:  engineeringVersion,
    NEXT_PUBLIC_RELEASE_NAME:         releaseName,
    NEXT_PUBLIC_GIT_COMMIT_SHA:       process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    NEXT_PUBLIC_GIT_COMMIT_REF:       process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
    NEXT_PUBLIC_BUILD_TIME:           new Date().toISOString(),
  },
  async headers() {
    return [
      {
        // Prevent Vercel CDN from caching any tenant website response.
        // Without this, a 404 on /[slug] gets cached before middleware runs.
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
