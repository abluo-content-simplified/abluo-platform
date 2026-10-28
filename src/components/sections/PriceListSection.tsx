import type { PriceListSection as PriceListSectionType, PriceListRow, PriceListHighlight, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { multiline } from '@/lib/multiline-text'
import { formatPrice, isAmount, rowPriceLine, rowSublabel, type PriceSectionSettings, type PriceLine } from '@/lib/price-list/format'

interface Props {
  section: PriceListSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  /** Page locale — formats the prices and picks the unit words. */
  locale?: string
}

/**
 * Price list — a generic platform section.
 *
 *   header      eyebrow · title (headline accent) · intro
 *   rows        one bordered card, hairline-divided rows: label + muted
 *               sub-label on the left, the price and a muted line under it
 *               (per-period figure or the row's own note) on the right
 *   highlights  optional heading + cards side by side (stacked on phones)
 *   footnote    small print, typed line breaks kept
 *
 * Prices are numbers formatted per locale (src/lib/price-list/format.ts).
 * Semantics: rows and cards are lists, so a screen reader announces "list,
 * 6 items" and reads each label with its price. The "/month" slash is
 * visual only — the spoken text says "per month".
 *
 * Server component: nothing here is interactive.
 */

/** Rows worth rendering: something to say on at least one side. */
export function visiblePriceRows(rows: PriceListRow[] | null | undefined): PriceListRow[] {
  return (rows ?? []).filter((r) => Boolean(r && (r.label?.trim() || isAmount(r.price))))
}

export function visibleHighlights(cards: PriceListHighlight[] | null | undefined): PriceListHighlight[] {
  return (cards ?? []).filter((c) => Boolean(c && (c.label?.trim() || isAmount(c.price) || c.description?.trim())))
}

/** Column classes for the highlight cards — never more columns than cards. */
export function highlightGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 2 || count === 4) return 'grid-cols-1 sm:grid-cols-2'
  return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
}

const MUTED = { color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' } as const

function SpokenLine({ line, className }: { line: PriceLine; className: string }) {
  if (line.visible === line.spoken) {
    return <p className={className} style={MUTED}>{line.visible}</p>
  }
  return (
    <p className={`whitespace-nowrap ${className}`} style={MUTED}>
      <span aria-hidden="true">{line.visible}</span>
      <span className="sr-only">{line.spoken}</span>
    </p>
  )
}

export function PriceListSection({ section, surface, designSystem, locale = 'en' }: Props) {
  const { eyebrow, title, headlineAccent, intro, highlightsTitle, footnote } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)

  const m = designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const ease = resolveEasing(m?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const settings: PriceSectionSettings = {
    locale,
    currency: section.currency,
    decimals: section.priceDecimals,
    perPeriod: section.perPeriod,
  }

  const rows = visiblePriceRows(section.rows)
  const cards = visibleHighlights(section.highlights)
  const hasHeader = Boolean(eyebrow || title || intro)
  const hasHighlights = cards.length > 0
  const hasFootnote = Boolean(footnote?.trim())

  if (!hasHeader && rows.length === 0 && !hasHighlights && !hasFootnote) return null

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      <div className="mx-auto w-full max-w-3xl">
        {hasHeader && (
          <SlideUp duration={duration} ease={ease} delay={0} className="mb-10 md:mb-14">
            {eyebrow && (
              <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} defaultAccent="none" weight="semibold" className="mb-5" />
            )}
            {title && (
              <h2
                className="[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'var(--font-size-h2, var(--fs-h2))',
                  fontWeight: 'var(--font-weight-h2, 600)',
                  lineHeight: 'var(--line-height-h2, 1.2)',
                  letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
                }}
              >
                {renderHeadline(title, headlineAccent)}
              </h2>
            )}
            {intro && (
              <p
                className={multiline('mt-5 text-base leading-relaxed')}
                style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', maxWidth: '60ch' }}
              >
                {intro}
              </p>
            )}
          </SlideUp>
        )}

        {rows.length > 0 && (
          <SlideUp duration={duration} ease={ease} delay={0.05}>
            <ul
              role="list"
              data-price-list-rows=""
              className="divide-y divide-[var(--color-border)] overflow-hidden"
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                backgroundColor: 'var(--color-surface, var(--color-background))',
              }}
            >
              {rows.map((row) => {
                const sub = rowSublabel(row, settings)
                const line = rowPriceLine(row, settings)
                const hasPrice = isAmount(row.price)
                return (
                  <li key={row._key} className="flex items-start justify-between gap-4 px-4 py-5 sm:px-8 sm:py-6">
                    <div className="min-w-0 flex-1">
                      {row.label && (
                        <p
                          className="text-base font-medium leading-snug sm:text-lg"
                          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}
                        >
                          {row.label}
                        </p>
                      )}
                      {sub && <p className="mt-1 text-sm leading-snug" style={MUTED}>{sub}</p>}
                    </div>
                    {(hasPrice || line) && (
                      <div className="max-w-[55%] shrink-0 text-right">
                        {hasPrice && (
                          <p
                            className="whitespace-nowrap font-semibold leading-tight tabular-nums"
                            style={{
                              color: 'var(--color-text-primary)',
                              fontFamily: 'var(--font-heading)',
                              fontSize: 'clamp(1.375rem, 1rem + 1.2vw, 1.875rem)',
                            }}
                          >
                            {formatPrice(row.price as number, settings)}
                          </p>
                        )}
                        {line && <SpokenLine line={line} className="mt-1 text-sm leading-snug" />}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </SlideUp>
        )}

        {hasHighlights && (
          <SlideUp duration={duration} ease={ease} delay={0.1} className="mt-12 md:mt-16">
            {highlightsTitle && (
              <h3
                className="mb-6 [--fs-h3:1.375rem] md:[--fs-h3:1.625rem]"
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-heading)',
                  fontSize: 'var(--font-size-h3, var(--fs-h3))',
                  fontWeight: 'var(--font-weight-h3, 600)',
                  lineHeight: 'var(--line-height-h3, 1.375)',
                  letterSpacing: 'var(--letter-spacing-h3, -0.025em)',
                }}
              >
                {highlightsTitle}
              </h3>
            )}
            <ul role="list" data-price-list-highlights="" className={`grid gap-4 ${highlightGridClass(cards.length)}`}>
              {cards.map((card) => (
                <li
                  key={card._key}
                  className="flex flex-col gap-2 p-6 sm:p-8"
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'var(--color-surface, var(--color-background))',
                  }}
                >
                  {card.label && (
                    <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
                      {card.label}
                    </p>
                  )}
                  {isAmount(card.price) && (
                    <p
                      className="whitespace-nowrap font-semibold leading-tight tabular-nums"
                      style={{
                        color: 'var(--color-text-primary)',
                        fontFamily: 'var(--font-heading)',
                        fontSize: 'clamp(1.75rem, 1.25rem + 1.5vw, 2.25rem)',
                      }}
                    >
                      {formatPrice(card.price, settings)}
                    </p>
                  )}
                  {card.description && (
                    <p className={multiline('text-sm leading-relaxed')} style={MUTED}>{card.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </SlideUp>
        )}

        {hasFootnote && (
          <p className={multiline('mt-8 text-sm leading-relaxed')} style={MUTED} data-price-list-footnote="">
            {footnote}
          </p>
        )}
      </div>
    </SectionContainer>
  )
}
