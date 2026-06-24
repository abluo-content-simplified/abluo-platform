import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const environment = process.env.NEXT_PUBLIC_VERCEL_ENV || 'development'
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

    // All values baked in at build time via next.config.ts — no git commands at runtime
    const release   = process.env.NEXT_PUBLIC_GIT_RELEASE      || 'unknown'
    const commitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA    || 'unknown'
    const commit    = commitSha.slice(0, 7)
    const branch    = process.env.NEXT_PUBLIC_GIT_COMMIT_REF    || 'unknown'
    const buildDate = process.env.NEXT_PUBLIC_BUILD_TIME
      ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toUTCString()
      : new Date().toUTCString()

    return NextResponse.json({
      release,
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
        version: 'unknown',
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
