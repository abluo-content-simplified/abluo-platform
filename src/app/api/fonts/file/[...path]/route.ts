import { NextResponse, type NextRequest } from 'next/server'
import { FONT_CONTENT_TYPES, upstreamFileUrl } from '@/lib/fonts/self-host'

// Self-hosted Google Fonts files — see src/lib/fonts/self-host.ts.
// Font files at a given path never change, so they are cached as immutable.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const upstream = upstreamFileUrl(path)
  if (!upstream) return new NextResponse('Not found', { status: 404 })

  let res: Response
  try {
    res = await fetch(upstream, { next: { revalidate: 60 * 60 * 24 * 30 } })
  } catch {
    return new NextResponse('Font service unavailable', { status: 502 })
  }
  if (!res.ok || !res.body) return new NextResponse('Not found', { status: 404 })

  const ext = path[path.length - 1].split('.').pop() ?? ''
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': FONT_CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
