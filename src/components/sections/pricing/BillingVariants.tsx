import type { ReactNode } from 'react'

export type BillingPeriod = 'month' | 'year'

/**
 * Both billing variants of one piece of content, server-rendered. CSS shows
 * the monthly one unless a billing switch on the page has "yearly" checked
 * (globals.css, "Billing switch"); the hidden one is display:none, so screen
 * readers read only the visible price.
 *
 * When `year` is null (nothing differs) the monthly content renders alone,
 * with no wrapper at all. Wrappers are display:contents, so they never change
 * the layout; use `as="span"` inside a paragraph, the default div elsewhere.
 */
export function BillingVariants({ month, year, as = 'div' }: { month: ReactNode; year: ReactNode | null; as?: 'div' | 'span' }) {
  if (year === null || year === undefined) return <>{month}</>
  const Tag = as
  return (
    <>
      <Tag data-billing-show="month">{month}</Tag>
      <Tag data-billing-show="year">{year}</Tag>
    </>
  )
}
