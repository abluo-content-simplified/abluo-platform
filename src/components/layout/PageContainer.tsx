/**
 * PageContainer — shared layout wrapper for standalone browsing pages.
 *
 * Used by: Live page, Events listing, Blog listing.
 * Not used by: section-based pages (those use SectionContainer per section).
 *
 * Owns the full-page scaffold (min-h-screen, background) and the inner
 * content container (centering, max-width, padding). Both live here so
 * no page needs to repeat the pattern.
 *
 * Padding scale — matches SectionContainer horizontal rhythm:
 *   Mobile:  24px horizontal, 48px top / 96px bottom
 *   Tablet:  40px horizontal, 56px top / 112px bottom
 *   Desktop: 64px horizontal, 64px top / 120px bottom
 *
 * Top padding is intentionally lighter than SectionContainer's vertical
 * rhythm because these pages begin with their own page header (title,
 * back button, or hero) — not a section background transition.
 *
 * TODO: max-width (currently 1120px) should eventually be a Design System
 * layout token, matching SectionContainer, so both can be updated from one place.
 */

interface PageContainerProps {
  children: React.ReactNode
}

export function PageContainer({ children }: PageContainerProps) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-background)' }}>
      <div className="mx-auto max-w-[1120px] px-6 pt-12 pb-24 md:px-10 md:pt-14 md:pb-28 lg:px-16 lg:pt-16 lg:pb-[7.5rem]">
        {children}
      </div>
    </div>
  )
}
