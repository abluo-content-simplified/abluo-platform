import type { ComparisonTableSection as ComparisonTableSectionType, ComparisonColumn, ComparisonCell, DesignSystem } from '@/lib/sanity/types'
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
import { billingOf, formatEquivalent } from '@/lib/pricing/billing'
import { BillingVariants } from '@/components/sections/pricing/BillingVariants'

interface Props {
  section: ComparisonTableSectionType
  surface: SurfaceType
  designSystem: DesignSystem | null
  locale?: string
}

/**
 * Comparison table — a generic platform section (inline content).
 *
 * A real <table>: column headers (`scope="col"`) with an optional price that
 * follows the page's monthly ⇄ yearly switch, one <tbody> per group with its
 * heading (`scope="colgroup"`), row headers (`scope="row"`) with an optional
 * note. Cells are ✓ (spoken "Included"), — (spoken "Not included") or short
 * text. Cells are matched to columns by position; a missing cell shows —.
 *
 * On phones the table scrolls sideways inside its rounded box with the first
 * column pinned, so the page itself never scrolls horizontally.
 */

const MUTED = { color: 'var(--color-text-muted)', fontFamily: 'var(--font-body)' } as const
const BODY = { color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' } as const
const HIGHLIGHT_BG = 'var(--color-background-alt, var(--color-surface))'
const BASE_BG = 'var(--color-surface, var(--color-background))'

export function visibleColumns(cols: ComparisonColumn[] | null | undefined): ComparisonColumn[] {
  return (cols ?? []).filter((c) => Boolean(c?.label?.trim()))
}

function ColumnPrice({ col, opts, msg, months }: { col: ComparisonColumn; opts: PriceFormatOptions; msg: PricingMessages; months: number | null | undefined }) {
  const b = billingOf(col, months)
  if (b.monthly === null) return null
  const line = (amount: string) => (
    <span className="block text-sm font-normal tabular-nums" style={MUTED}>
      {amount}
      <span aria-hidden="true">{msg.perMonthShort}</span>
      <span className="sr-only"> {msg.perMonthSpoken}</span>
    </span>
  )
  return (
    <BillingVariants
      as="span"
      month={line(formatPrice(b.monthly, opts))}
      year={b.monthlyEquivalent !== null ? line(formatEquivalent(b.monthlyEquivalent, opts)) : null}
    />
  )
}

function Cell({ cell, msg }: { cell: ComparisonCell | undefined; msg: PricingMessages }) {
  const kind = cell?.kind ?? 'notIncluded'
  if (kind === 'text' && cell?.text?.trim()) {
    return <span className="text-sm" style={BODY}>{cell.text}</span>
  }
  if (kind === 'included') {
    return (
      <>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-success, var(--color-primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <span className="sr-only">{msg.included}</span>
      </>
    )
  }
  return (
    <>
      <span aria-hidden="true" style={MUTED}>—</span>
      <span className="sr-only">{msg.notIncluded}</span>
    </>
  )
}

export function ComparisonTableSection({ section, surface, designSystem, locale = 'en' }: Props) {
  const { eyebrow, title, headlineAccent, intro, footnote } = section
  const surfaceStyles = getSurfaceStyles(designSystem, surface)
  const motion = designSystem?.motion
  const duration = motion?.durationSlow !== undefined ? motion.durationSlow / 1000 : 0.35
  const ease = resolveEasing(motion?.easingDecelerate, [0.0, 0.0, 0.2, 1])

  const msg = getPricingMessages(locale)
  const opts: PriceFormatOptions = { locale, currency: section.currency, decimals: section.priceDecimals }
  const columns = visibleColumns(section.compareColumns)
  const groups = (section.compareGroups ?? [])
    .map((g) => ({ ...g, rows: (g?.compareRows ?? []).filter((r) => r?.label?.trim()) }))
    .filter((g) => g.rows.length > 0)
  const hasHeader = Boolean(eyebrow || title || intro)

  if (columns.length === 0 || groups.length === 0) {
    if (!hasHeader) return null
  }

  // Cells are matched by position to the columns AS STORED (an empty column
  // that is not rendered must not shift the cells of the ones after it).
  const stored = section.compareColumns ?? []
  const indexes = stored.map((c, i) => (c?.label?.trim() ? i : -1)).filter((i) => i >= 0)

  return (
    <SectionContainer id={section.anchorId} style={surfaceStyles}>
      {hasHeader && (
        <SlideUp duration={duration} ease={ease} delay={0} className="mb-8 md:mb-10">
          {eyebrow && <EyebrowLabel eyebrow={eyebrow} designSystem={designSystem} defaultAccent="none" weight="semibold" className="mb-5" />}
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
            <p className={multiline('mt-5 text-base leading-relaxed')} style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)', maxWidth: '60ch' }}>
              {intro}
            </p>
          )}
        </SlideUp>
      )}

      {columns.length > 0 && groups.length > 0 && (
        <SlideUp duration={duration} ease={ease} delay={0.05}>
          <div className="overflow-x-auto" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', backgroundColor: BASE_BG }} data-comparison-table="">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th scope="col" className="sticky left-0 z-[1] px-5 py-4 text-sm font-medium" style={{ ...MUTED, backgroundColor: BASE_BG }}>
                    {section.firstColumnLabel ?? ''}
                  </th>
                  {indexes.map((i) => {
                    const col = stored[i]
                    return (
                      <th
                        key={col._key}
                        scope="col"
                        className="px-4 py-4 text-center align-top text-base font-semibold"
                        style={{ ...BODY, fontFamily: 'var(--font-heading)', backgroundColor: col.highlighted ? HIGHLIGHT_BG : undefined }}
                      >
                        <span className="block">{col.label}</span>
                        <ColumnPrice col={col} opts={opts} msg={msg} months={section.yearlyPaidMonths} />
                      </th>
                    )
                  })}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g._key}>
                  {g.title && (
                    <tr>
                      <th
                        scope="colgroup"
                        colSpan={indexes.length + 1}
                        className="px-5 pb-2 pt-6 text-xs font-semibold uppercase tracking-wide"
                        style={{ ...MUTED, backgroundColor: BASE_BG }}
                      >
                        {g.title}
                      </th>
                    </tr>
                  )}
                  {g.rows.map((r) => (
                    <tr key={r._key} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <th scope="row" className="sticky left-0 z-[1] px-5 py-3.5 align-top font-normal" style={{ backgroundColor: BASE_BG }}>
                        <span className="block text-[15px] font-medium leading-snug" style={BODY}>{r.label}</span>
                        {r.note && <span className="mt-0.5 block text-sm leading-snug" style={MUTED}>{r.note}</span>}
                      </th>
                      {indexes.map((i) => (
                        <td
                          key={stored[i]._key}
                          className="px-4 py-3.5 text-center align-top"
                          style={{ backgroundColor: stored[i].highlighted ? HIGHLIGHT_BG : undefined }}
                        >
                          <Cell cell={r.cells?.[i]} msg={msg} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </SlideUp>
      )}

      {footnote?.trim() && (
        <p className={multiline('mt-6 text-sm leading-relaxed')} style={MUTED} data-comparison-footnote="">
          {footnote}
        </p>
      )}
    </SectionContainer>
  )
}
