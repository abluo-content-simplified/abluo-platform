'use client'

/**
 * FirstTouchRecorder — records the session's external entry + page count.
 *
 * Mounted once in the tenant website layout. Renders nothing. On the first
 * page of a browsing session it stores the landing page, the EXTERNAL referrer
 * and the campaign tags in sessionStorage; on every later navigation it only
 * increments the page count. Nothing is sent anywhere: the record is read by
 * `collectClientSource()` when — and only when — the visitor submits a form.
 * See `src/lib/forms/first-touch.ts` for the privacy contract.
 */
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { getSessionStorage, recordPageView } from '@/lib/forms/first-touch'

export function FirstTouchRecorder({ scope }: { scope: string }) {
  const pathname = usePathname()
  useEffect(() => {
    try {
      const loc = window.location
      recordPageView(getSessionStorage(), scope, {
        href: loc.href,
        pathname: loc.pathname,
        hostname: loc.hostname,
        search: loc.search,
        referrer: typeof document !== 'undefined' ? document.referrer : '',
      })
    } catch {
      // Never let attribution break the page.
    }
  }, [scope, pathname])
  return null
}
