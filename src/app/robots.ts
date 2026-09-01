import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { buildRobotsForHost } from '@/lib/seo/indexability'

/**
 * Host-aware robots.txt (Layer 2 of the anti-indexing pair; Layer 1 is the
 * `X-Robots-Tag` header block in `next.config.ts`).
 *
 * Reading `headers()` makes this route dynamic. That is deliberate and
 * required: one deployment serves every host, so a statically generated
 * robots.txt would necessarily be wrong for all but one of them. The old
 * unconditional version was `allow: '/'` on every host, which is what let
 * `dev.abluo.app` — a public, unprotected, complete copy of every client site —
 * invite crawlers in.
 *
 * `/robots.txt` bypasses all rewriting in `src/proxy.ts` (see its static-asset
 * bypass, which matches `robots.txt` explicitly), so this route sees the real
 * `Host` header on every domain.
 *
 * All policy lives in `@/lib/seo/indexability` so it can be unit-tested without
 * mocking `next/headers`, and so the staging-host pattern has exactly one
 * definition shared with `next.config.ts`.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers()
  return buildRobotsForHost(requestHeaders.get('host'))
}
