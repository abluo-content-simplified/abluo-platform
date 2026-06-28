import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const environment = process.env.NEXT_PUBLIC_VERCEL_ENV || 'development'
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

    // Single version (Release Automation v2). All values baked at build time via
    // next.config.ts — no git/fs at runtime. The build is uniquely identified by
    // commit + branch + environment + build time (there is no engineering version).
    const platformVersion = process.env.NEXT_PUBLIC_PLATFORM_VERSION || 'unknown'
    const releaseTitle    = process.env.NEXT_PUBLIC_RELEASE_TITLE || ''

    const commitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || 'unknown'
    const commit    = commitSha.slice(0, 7)
    const branch    = process.env.NEXT_PUBLIC_GIT_COMMIT_REF || 'unknown'
    // ISO timestamp — the client formats it in the user's local timezone.
    const buildDate = process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString()

    return NextResponse.json({
      platformVersion,
      releaseTitle,
      commit,
      commitLong: commitSha,
      branch,
      environment,
      dataset,
      buildDate,
    })
  } catch (error) {
    console.error('Error fetching version info:', error)
    return NextResponse.json(
      {
        platformVersion: 'unknown',
        releaseTitle: '',
        commit: 'unknown',
        commitLong: 'unknown',
        branch: 'unknown',
        environment: 'unknown',
        dataset: 'unknown',
        buildDate: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
