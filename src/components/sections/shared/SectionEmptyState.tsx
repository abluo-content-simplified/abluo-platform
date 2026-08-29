// ─── Shared listing-section empty state ────────────────────────────────────
// ADR-016 Phase B — identical empty-state visual treatment for all three
// module listing sections (blogListingSection, eventsListingSection,
// liveLatestSection). Semantics (frontend concern, decided by the calling
// section component): render only when the section-level `emptyStateHeading`
// field is set — otherwise the caller returns null and this component is
// never invoked. `emptyStateHeading` is required here; `emptyStateBody` is
// optional supporting text.
//
// Visual treatment mirrors the existing blog listing page empty state
// (src/app/[locale]/(website)/[tenant]/blog/page.tsx) so a tenant sees a
// consistent empty state whether they hit the fixed page or a composed
// section.

import { FadeIn } from '@/components/animation'

interface SectionEmptyStateProps {
  /** Required — the caller only renders this component when heading is set. */
  heading: string
  /** Optional supporting text below the heading. */
  body?: string
  duration: number
  ease: string | number[]
}

export function SectionEmptyState({ heading, body, duration, ease }: SectionEmptyStateProps) {
  return (
    <FadeIn duration={duration} ease={ease}>
      <div
        className="rounded-[var(--radius-lg)] px-8 py-14 text-center"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <p
          className="mb-2 text-lg font-semibold"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
        >
          {heading}
        </p>
        {body && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {body}
          </p>
        )}
      </div>
    </FadeIn>
  )
}
