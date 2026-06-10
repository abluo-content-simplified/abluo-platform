import { execSync } from 'child_process'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const environment = process.env.VERCEL_ENV || 'localhost'
    const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

    // Get latest git tag (version)
    let version = 'unknown'
    try {
      version = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' }).trim()
      // Remove 'v' prefix if present
      if (version.startsWith('v')) {
        version = version.slice(1)
      }
    } catch {
      // Fallback for production: use "production" or "preview" as version
      version = environment === 'production' ? 'production' : environment
    }

    // Get short commit hash
    let commit = 'unknown'
    let commitLong = 'unknown'
    try {
      commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
      commitLong = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      // Fallback for production: use Vercel env vars
      commitLong = process.env.VERCEL_GIT_COMMIT_SHA || 'unknown'
      commit = commitLong.substring(0, 7) // Take first 7 chars as short hash
    }

    // Get current branch
    let branch = 'unknown'
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
    } catch {
      // Fallback for production: use Vercel env var
      branch = process.env.VERCEL_GIT_COMMIT_REF || 'unknown'
    }

    // Get build date
    const buildDate = new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })

    return NextResponse.json({
      version,
      commit,
      commitLong,
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
