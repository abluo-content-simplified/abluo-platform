'use client'

import { useEffect, useRef } from 'react'

/**
 * Digital Cards statistics beacon (ADR-049 D11). Pages are cached, so counting
 * happens in the browser: one `visit` per page view and one `click` per tap on
 * a card link (`[data-card-link]`), sent with navigator.sendBeacon to
 * POST /api/cards/hit. What it sends: the project, the card's public id, the
 * link key, the `?src=` tag and the referrer HOST only (never the path) — no
 * cookie, no storage, no visitor id.
 *
 * `countable` comes from the server (production deployment on the project's
 * own domain); when false nothing is ever sent. The endpoint re-checks all of
 * it anyway — this only saves pointless requests from previews.
 */
export function CardBeacon({ projectSlug, cardId, countable }: { projectSlug: string; cardId: string; countable: boolean }) {
  const sentVisit = useRef(false)

  useEffect(() => {
    if (!countable || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return

    const src = new URLSearchParams(window.location.search).get('src') ?? undefined
    let r: string | undefined
    try {
      const host = document.referrer ? new URL(document.referrer).host : ''
      r = host && host !== window.location.host ? host : undefined
    } catch {
      r = undefined
    }
    const send = (body: Record<string, string | undefined>) => {
      try {
        navigator.sendBeacon('/api/cards/hit', new Blob([JSON.stringify({ p: projectSlug, c: cardId, s: src, r, ...body })], { type: 'text/plain' }))
      } catch {
        // Counting is best-effort; never break the card.
      }
    }

    if (!sentVisit.current) {
      sentVisit.current = true
      send({ k: 'visit' })
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-card-link]') : null
      const key = target?.getAttribute('data-card-link')
      if (key) send({ k: 'click', l: key })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [projectSlug, cardId, countable])

  return null
}
