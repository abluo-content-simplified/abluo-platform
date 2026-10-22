import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { adjacentPages } from '@/lib/modules/brand-hub/navigation'
import type { BrandHubPageId } from '@/lib/modules/brand-hub/types'
import { FOCUS_RING, HEADING_FONT } from './shared'

/** Previous / next page links with the page titles, in the side navigation's order. */
export function PagePager({ page, m, hrefFor }: {
  page: BrandHubPageId
  m: BrandHubMessages
  hrefFor: (p: BrandHubPageId) => string
}) {
  const { previous, next } = adjacentPages(page)
  if (!previous && !next) return null

  const card = (p: BrandHubPageId, dir: 'previous' | 'next') => (
    <Link
      href={hrefFor(p)}
      rel={dir === 'previous' ? 'prev' : 'next'}
      className={`flex min-w-0 flex-1 flex-col gap-1 p-4 transition-opacity hover:opacity-80 ${dir === 'next' ? 'items-end text-right' : 'items-start text-left'} ${FOCUS_RING}`}
      style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
    >
      <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
        {dir === 'previous' && <ArrowLeft size={14} aria-hidden="true" />}
        {dir === 'previous' ? m.pager.previous : m.pager.next}
        {dir === 'next' && <ArrowRight size={14} aria-hidden="true" />}
      </span>
      <span className="text-base font-semibold" style={{ ...HEADING_FONT, color: 'var(--color-text-primary)' }}>
        {m.pages[p].title}
      </span>
    </Link>
  )

  return (
    <nav aria-label={m.pager.label} className="mt-16 flex flex-col gap-3 sm:flex-row print:hidden">
      {previous ? card(previous, 'previous') : <span className="hidden flex-1 sm:block" />}
      {next ? card(next, 'next') : <span className="hidden flex-1 sm:block" />}
    </nav>
  )
}
