import { cache } from 'react'
import { headers } from 'next/headers'
import { isHostScopedSegment } from './link-scope'

/**
 * Server-side: does the current request reach `segment` on the site's own
 * host? Cached per request — the layout, the page and the footer all ask.
 * See `./link-scope` for what the answer means.
 */
export const isHostScopedRequest = cache(async (segment: string): Promise<boolean> => {
  const h = await headers()
  return isHostScopedSegment(h.get('host'), segment)
})
