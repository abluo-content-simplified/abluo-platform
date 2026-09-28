import { NextResponse, type NextRequest } from 'next/server'
import { MODERN_UA, rewriteFontUrls, upstreamCssUrl } from '@/lib/fonts/self-host'

// Self-hosted Google Fonts stylesheet — see src/lib/fonts/self-host.ts.
// The visitor's browser calls THIS endpoint; only our server talks to Google.

export async function GET(request: NextRequest) {
  const upstream = upstreamCssUrl(request.nextUrl.searchParams)
  if (!upstream) return new NextResponse('Bad font request', { status: 400 })

  let res: Response
  try {
    res = await fetch(upstream, {
      headers: { 'User-Agent': MODERN_UA },
      next: { revalidate: 60 * 60 * 24 },
    })
  } catch {
    return new NextResponse('Font service unavailable', { status: 502 })
  }
  if (!res.ok) return new NextResponse('Font service error', { status: res.status === 400 ? 400 : 502 })

  const css = rewriteFontUrls(await res.text())
  return new NextResponse(css, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      // Browser: 1 day. CDN: 30 days, then refreshed in the background.
      'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400',
    },
  })
}
