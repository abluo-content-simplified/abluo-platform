// Stars (ADR-048 D5) — a rating as five stars, named for screen readers
// ("4 out of 5 stars"). Colour from the design system only: filled stars use
// the primary colour, empty ones the border colour.

export function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} aria-hidden="true" viewBox="0 0 20 20" width={16} height={16} fill="currentColor" style={{ color: n <= rating ? 'var(--color-primary)' : 'var(--color-border)' }}>
          <path d="M10 1.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L1.4 7.8l6-.8L10 1.5z" />
        </svg>
      ))}
    </span>
  )
}
