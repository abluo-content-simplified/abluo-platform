'use client'

import { useParams } from 'next/navigation'
import type { Cta } from '@/lib/sanity/types'
import { resolveCta, prefixCtaHref } from '@/lib/sanity/cta'

/**
 * Makes a whole feature card clickable, with the card TITLE as the link.
 *
 * ── Why the title and not the "Leggi →" ──────────────────────────────────────
 * The card used to be a plain div whose only interactive element was the
 * "Leggi →" anchor at its foot. It lifted and its image zoomed on hover, so it
 * looked clickable everywhere and was clickable nowhere — a visitor had to find
 * the one small link. Worse, every card's link was called "Leggi", so a screen
 * reader announced six links with identical names and no way to tell them
 * apart: a WCAG 2.4.4 (Link Purpose) failure.
 *
 * Putting the link on the title fixes both. The accessible name becomes the
 * service ("Terapia Individuale"), and the `::after` stretches that single
 * anchor over the whole card.
 *
 * ── Why ::after and not an overlay anchor ────────────────────────────────────
 * An `<a className="absolute inset-0">` laid over the card would also work, but
 * it sits on top of the text and kills selection — a visitor cannot copy the
 * description. The pseudo-element has no such effect.
 *
 * ── Why after:z-[2] ──────────────────────────────────────────────────────────
 * The card's image, kicker, description and bullets each carry `relative
 * z-[1]` (they sit above the ordinal watermark). A ::after at the default
 * `z-index: auto` therefore ends up UNDERNEATH all of them: the hit area
 * survives only in the padding between elements, so the pointer picks up the
 * link in the gaps and loses it over the text -- the href flickering in and
 * out of the status bar, and clicks landing on nothing. z-[2] puts the hit
 * area above its siblings, where it has to be.
 *
 * ── The positioning contract ─────────────────────────────────────────────────
 * `::after` resolves against the nearest POSITIONED ancestor, so the card must
 * be `relative` and nothing between the card and this anchor may be. That is
 * why FeatureGridSection drops `relative` from the <h3> when a card is linked;
 * left in, the hit area would cover the heading only — which looks like it
 * works and silently isn't.
 *
 * Client component for the same reason FeatureCardCta is one: tenant and locale
 * are URL params, so the href cannot be resolved on the server.
 */
export function FeatureCardTitleLink({ cta, children }: { cta: Cta; children: React.ReactNode }) {
  const params = useParams()
  const locale = params?.locale as string | undefined
  const tenantId = params?.tenant as string | undefined

  const resolved = prefixCtaHref(resolveCta(cta), locale, tenantId)
  if (resolved.type !== 'link') return <>{children}</>

  return (
    <a
      href={resolved.href}
      {...(resolved.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="no-underline after:absolute after:inset-0 after:z-[2] after:content-[''] focus:outline-none"
      style={{ color: 'inherit' }}
    >
      {children}
    </a>
  )
}
