/**
 * ADR-044 D11 — the frame of the two private link pages (booking, My pass):
 * the site's normal section container and heading style, so the page looks
 * like the club's own site (nav and footer come from the tenant layout).
 *
 * Server-safe (no hooks). Takes only text and children — no page data.
 */
import { SectionContainer } from '@/components/layout/SectionContainer'
import type { ReactNode } from 'react'

export const HEADING_STYLE = {
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-heading)',
  fontSize: 'var(--font-size-h2, var(--fs-h2))',
  fontWeight: 'var(--font-weight-h2, 600)',
  lineHeight: 'var(--line-height-h2, 1.375)',
  letterSpacing: 'var(--letter-spacing-h2, -0.025em)',
} as const

export function PageShell({ title, children, centered = false }: { title: string; children: ReactNode; centered?: boolean }) {
  return (
    <SectionContainer>
      <div className={`mx-auto w-full max-w-[720px] py-4 md:py-8 ${centered ? 'text-center' : ''}`} data-reservations-page>
        <h1 className="text-balance [--fs-h2:1.75rem] md:[--fs-h2:2.25rem]" style={HEADING_STYLE}>
          {title}
        </h1>
        {children}
      </div>
    </SectionContainer>
  )
}

/**
 * "Link not valid" / "try again later" / "unavailable": one calm screen. The
 * invalid text is identical whatever the reason, so it never hints whether a
 * link existed.
 */
export function LinkNotice({ heading, body, homeHref, homeLabel }: { heading: string; body: string; homeHref: string; homeLabel: string }) {
  return (
    <SectionContainer>
      <div className="mx-auto flex min-h-[40vh] max-w-[640px] flex-col items-center justify-center py-8 text-center" data-reservations-notice>
        <h1 className="text-balance [--fs-h2:1.875rem] md:[--fs-h2:2.25rem]" style={HEADING_STYLE}>
          {heading}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-pretty" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
          {body}
        </p>
        <a href={homeHref} className="mt-8 text-sm underline underline-offset-4 hover:opacity-80" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
          {homeLabel}
        </a>
      </div>
    </SectionContainer>
  )
}
