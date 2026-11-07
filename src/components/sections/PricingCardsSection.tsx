import type { PricingCardsSection as PricingCardsSectionType, PricingCard, DesignSystem } from '@/lib/sanity/types'
import { getSurfaceStyles } from '@/lib/sanity/surfaces'
import type { SurfaceType } from '@/lib/sanity/surfaces'
import { SlideUp } from '@/components/animation/SlideUp'
import { SectionContainer } from '@/components/layout/SectionContainer'
import { resolveEasing } from '@/lib/motion/easing'
import { renderHeadline } from '@/lib/headline-accent'
import { EyebrowLabel } from '@/components/sections/EyebrowLabel'
import { multiline } from '@/lib/multiline-text'
import { formatPrice, type PriceFormatOptions } from '@/lib/price-list/format'
import { getPricingMessages, type PricingMessages } from '@/lib/i18n/pricing-messages'
import { billingOf, formatEquivalent, hasBothPeriods, savingBadge, savingBadgeText, yearlyLine, yearlyTotalLine, type Billing } from '@/lib/pricing/billing'
import { BillingSwitch } from '@/components/sections/pricing/BillingSwitch'
import { BillingVariants } from '@/components/sections/pricing/BillingVariants'
import { PricingCardCta } from '@/components/sections/pricing/PricingCardCta'

interface Props {
  section: PricingCardsSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale?: string
}

/**
 * Pricing cards — a generic platform section (inline content).
 *
 *   header     eyebrow · title · intro · optional monthly ⇄ yearly switch and
 *              the period note under it
 *   cards      'plans': large cards, top-aligned — name + badge, description,
 *                       big price, billing line, button, bullet points
 *              'compact': smaller cards in a grid — name, price line,
 *                       description, details, bullets, audience, text link
 *   included   optional "every plan includes" chips
 *   footnote   small print
 *
 * Every price with a yearly figure renders both variants (BillingVariants);
 * the page's switch decides which one shows, in this section and every other
 * pricing section on the page. Server component; only the switch and the
 * buttons are client islands.
 */

const MUTED = { color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' } as const
const SECONDARY = { color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' } as const
const CARD_BOX = { borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--color-surface, var(--color-background))' } as const

export function visiblePricingCards(cards: PricingCard[] | null | undefined): PricingCard[] {
  return (cards ?? []).filter((c) => Boolean(c && c.name?.trim()))
}

/** Column classes — never more columns than cards. */
export function pricingGridClass(count: number, layout: 'plans' | 'compact'): string {
  if (count <= 1) return 'grid-cols-1'
  if (count === 2 || count === 4) return layout === 'compact' && count === 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 md:grid-cols-2'
  return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
}

/** "€29 / month" — the visible slash form plus its spoken form. */
function Amount({ amount, unit, unitSpoken, size }: { amount: string; unit: string; unitSpoken: string; size: 'big' | 'small' }) {
  return (
    <>
      <span
        className="font-semibold tabular-nums"
        style={{
          color: 'var(--color-text-primary)',
          fontFamily: 'var(--font-heading)',
          fontSize: size === 'big' ? 'clamp(2.25rem, 1.75rem + 1.5vw, 3rem)' : '1.125rem',
          lineHeight: 1.1,
        }}
      >
        {amount}
      </span>{' '}
      <span aria-hidden="true" className={size === 'big' ? 'text-base' : 'text-sm'} style={SECONDARY}>
        {unit}
      </span>
      <span className="sr-only">{unitSpoken}</span>
    </>
  )
}

function PlanPrice({ card, b, opts, msg }: { card: PricingCard; b: Billing; opts: PriceFormatOptions; msg: PricingMessages }) {
  const prefix = card.pricePrefix?.trim()
  const note = card.priceNote?.trim()
  const line = (text: string | null) => (text ? <p className="mt-2 text-sm leading-snug" style={MUTED}>{text}</p> : null)

  if (b.monthly === null && b.yearly === null) return note ? line(note) : null

  // Only a yearly price: show it as a yearly figure in both views.
  if (b.monthly === null && b.yearly !== null) {
    return (
      <div>
        <p>{prefix && <span className="mr-1.5 text-sm" style={SECONDARY}>{prefix}</span>}<Amount amount={formatPrice(b.yearly, opts)} unit={msg.perYear} unitSpoken={msg.perYearSpoken} size="big" /></p>
        {line(note ?? null)}
      </div>
    )
  }

  const monthly = (
    <>
      <p>{prefix && <span className="mr-1.5 text-sm" style={SECONDARY}>{prefix}</span>}<Amount amount={formatPrice(b.monthly as number, opts)} unit={msg.perMonth} unitSpoken={msg.perMonthSpoken} size="big" /></p>
      {line(note ?? msg.billedMonthly)}
    </>
  )
  const yearly =
    b.yearly === null || b.monthlyEquivalent === null ? null : (
      <>
        <p>{prefix && <span className="mr-1.5 text-sm" style={SECONDARY}>{prefix}</span>}<Amount amount={formatEquivalent(b.monthlyEquivalent, opts)} unit={msg.perMonth} unitSpoken={msg.perMonthSpoken} size="big" /></p>
        {line(note ?? yearlyLine(b, opts, msg))}
      </>
    )
  return (
    <div data-pricing-price="">
      <BillingVariants month={monthly} year={yearly} />
    </div>
  )
}

function CompactPrice({ card, b, opts, msg, yearlyTotal }: { card: PricingCard; b: Billing; opts: PriceFormatOptions; msg: PricingMessages; yearlyTotal: boolean }) {
  const prefix = card.pricePrefix?.trim()
  const pre = prefix ? <span className="mr-1 text-sm" style={SECONDARY}>{prefix}</span> : null
  if (b.monthly === null && b.yearly === null) return null
  if (b.monthly === null && b.yearly !== null) {
    return <p>{pre}<Amount amount={formatPrice(b.yearly, opts)} unit={msg.perYear} unitSpoken={msg.perYearSpoken} size="small" /></p>
  }
  const monthly = <p>{pre}<Amount amount={formatPrice(b.monthly as number, opts)} unit={msg.perMonth} unitSpoken={msg.perMonthSpoken} size="small" /></p>
  let yearly: React.ReactNode = null
  if (b.yearly !== null && b.monthlyEquivalent !== null) {
    yearly = yearlyTotal ? (
      <p>
        {pre}
        <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
          {yearlyTotalLine(b, opts, msg)}
        </span>
      </p>
    ) : (
      <p>{pre}<Amount amount={formatEquivalent(b.monthlyEquivalent, opts)} unit={msg.perMonth} unitSpoken={msg.perMonthSpoken} size="small" /></p>
    )
  }
  return (
    <div data-pricing-price="">
      <BillingVariants month={monthly} year={yearly} />
    </div>
  )
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul role="list" className="flex flex-col gap-2.5">
      {items.map((f, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[15px] leading-snug" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-success, var(--color-primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  )
}

function cleanList(list: (string | null)[] | null | undefined): string[] {
  return (list ?? []).filter((s): s is string => typeof s === 'string' && s.trim() !== '')
}

export function PricingCardsSection({ section, surface, designSystem, locale = 'en' }: Props) {
  const { eyebrow, title, headlineAccent, intro, includedTitle, footnote } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const motion = designSystem?.motion
  const duration = motion?.durationSlow !== undefined ? motion.durationSlow / 1000 : 0.35
  const ease = resolveEasing(motion?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const msg = getPricingMessages(locale)
  const opts: PriceFormatOptions = { locale, currency: section.currency, decimals: section.priceDecimals }
  const layout = section.cardLayout === 'compact' ? 'compact' : 'plans'
  const months = section.yearlyPaidMonths
  const cards = visiblePricingCards(section.pricingCards)
  const included = cleanList(section.included)
  const both = hasBothPeriods(cards, months)
  const showSwitch = Boolean(section.showBillingSwitch) && both
  const badge = showSwitch ? savingBadgeText(savingBadge(cards, months), msg) : null
  const noteMonthly = section.periodNoteMonthly?.trim() || null
  const noteYearly = section.periodNoteYearly?.trim() || null
  const hasNote = Boolean(noteMonthly || (both && noteYearly))
  const hasHeader = Boolean(eyebrow || title || intro || showSwitch || hasNote)

  if (!hasHeader && cards.length === 0 && included.length === 0 && !footnote?.trim()) return null

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className={layout === 'plans' ? 'mb-10 text-center md:mb-14' : 'mb-8 md:mb-10'}>
          {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} defaultAccent="none" weight="semibold" className="mb-5" />}
          {title && <SectionTitle title={title} accent={headlineAccent} asPageHeading={Boolean(section.titleIsPageHeading)} />}
          {intro && (
            <p
              className={multiline(`mt-5 text-base leading-relaxed ${layout === 'plans' ? 'mx-auto' : ''}`)}
              style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', maxWidth: '60ch' }}
            >
              {intro}
            </p>
          )}
          {showSwitch && (
            <div className="mt-8">
              <BillingSwitch legend={msg.billingPeriod} monthlyLabel={msg.monthly} yearlyLabel={msg.yearly} badge={badge} />
            </div>
          )}
          {hasNote && (
            <p className={multiline(`mt-4 text-sm leading-relaxed ${layout === 'plans' ? 'mx-auto' : ''}`)} style={{ ...MUTED, maxWidth: '60ch' }}>
              {both ? <BillingVariants as="span" month={noteMonthly} year={noteYearly && noteYearly !== noteMonthly ? noteYearly : null} /> : noteMonthly}
            </p>
          )}
        </SlideUp>
      )}

      {cards.length > 0 && (
        <SlideUp duration={duration} ease={ease} delay={0.05}>
          <ul role="list" data-pricing-cards={layout} className={`grid gap-5 ${pricingGridClass(cards.length, layout)}`}>
            {cards.map((card) => {
              const b = billingOf(card, months)
              const features = cleanList(card.features)
              const details = (card.details ?? []).filter((d) => d?.label?.trim())
              const highlighted = Boolean(card.highlighted)
              return (
                <li
                  key={card._key}
                  className={`flex flex-col ${layout === 'plans' ? 'gap-5 p-7' : 'gap-3 p-6'}`}
                  style={{
                    ...CARD_BOX,
                    border: highlighted ? '2px solid var(--color-text-primary)' : '1px solid var(--color-border)',
                  }}
                  data-highlighted={highlighted ? '' : undefined}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3
                      className={layout === 'plans' ? 'text-xl font-semibold leading-7' : 'text-lg font-semibold leading-snug'}
                      style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
                    >
                      {card.name}
                    </h3>
                    {card.badge?.trim() && (
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold leading-4"
                        style={{ backgroundColor: 'var(--color-background-alt, var(--color-surface))', color: 'var(--color-primary)', fontFamily: 'var(--font-body)' }}
                      >
                        {card.badge}
                      </span>
                    )}
                  </div>

                  {layout === 'plans' ? (
                    <>
                      {card.tagline && <p className={multiline('text-[15px] leading-relaxed')} style={SECONDARY}>{card.tagline}</p>}
                      <PlanPrice card={card} b={b} opts={opts} msg={msg} />
                      {card.cta && <PricingCardCta cta={card.cta} variant={highlighted ? 'primary' : 'secondary'} />}
                      {details.length > 0 && <Details details={details} />}
                      <Bullets items={features} />
                      {card.audience?.trim() && <p className="text-sm" style={MUTED}>{card.audience}</p>}
                    </>
                  ) : (
                    <>
                      <CompactPrice card={card} b={b} opts={opts} msg={msg} yearlyTotal={section.yearlyDisplay === 'yearlyTotal'} />
                      {card.priceNote?.trim() && <p className="text-sm" style={MUTED}>{card.priceNote}</p>}
                      {card.tagline && <p className={multiline('text-[15px] leading-relaxed')} style={SECONDARY}>{card.tagline}</p>}
                      {details.length > 0 && <Details details={details} />}
                      <Bullets items={features} />
                      {card.audience?.trim() && <p className="text-sm" style={MUTED}>{card.audience}</p>}
                      {card.cta && (
                        <div className="mt-auto pt-2">
                          <PricingCardCta cta={card.cta} variant="link" />
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </SlideUp>
      )}

      {included.length > 0 && (
        <SlideUp duration={duration} ease={ease} delay={0.1} className={`mt-10 ${layout === 'plans' ? 'text-center' : ''}`}>
          {includedTitle && (
            <h3 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
              {includedTitle}
            </h3>
          )}
          <ul role="list" data-pricing-included="" className={`flex flex-wrap gap-2 ${layout === 'plans' ? 'justify-center' : ''}`}>
            {included.map((item, i) => (
              <li
                key={i}
                className="rounded-full px-3.5 py-1.5 text-sm"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}
              >
                {item}
              </li>
            ))}
          </ul>
        </SlideUp>
      )}

      {footnote?.trim() && (
        <p className={multiline(`mt-8 text-sm leading-relaxed ${layout === 'plans' ? 'text-center' : ''}`)} style={MUTED} data-pricing-footnote="">
          {footnote}
        </p>
      )}
    </SectionContainer>
  )
}

function Details({ details }: { details: { _key: string; label?: string; value?: string }[] }) {
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {details.map((d) => (
        <div key={d._key} className="flex gap-2">
          <dt className="shrink-0" style={MUTED}>{d.label}</dt>
          <dd style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>{d.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** h2 by default; h1 (DS h1 tokens) when the section opens a page with no hero. */
function SectionTitle({ title, accent, asPageHeading }: { title: string; accent: PricingCardsSectionType['headlineAccent']; asPageHeading: boolean }) {
  const Tag = asPageHeading ? 'h1' : 'h2'
  const lvl = asPageHeading ? 'h1' : 'h2'
  return (
    <Tag
      className={asPageHeading ? '[--fs-h1:2.25rem] md:[--fs-h1:3rem]' : '[--fs-h2:1.875rem] md:[--fs-h2:2.25rem]'}
      style={{
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-heading)',
        fontSize: `var(--font-size-${lvl}, var(--fs-${lvl}))`,
        fontWeight: `var(--font-weight-${lvl}, 600)`,
        lineHeight: `var(--line-height-${lvl}, ${asPageHeading ? 1.1 : 1.2})`,
        letterSpacing: `var(--letter-spacing-${lvl}, -0.025em)`,
      }}
    >
      {renderHeadline(title, accent)}
    </Tag>
  )
}
