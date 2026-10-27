// ── FeaturedBadge — the mark on a featured catalogue item ─────────────────────
//
// Shown only where a Catalogue Section highlights featured items. The text is
// the section's own localized label (content, not a messages bundle, so it
// works in every site language); without one, a star alone, named for
// screen readers by nothing more than the item it sits on.

export function FeaturedBadge({ label, className = '' }: { label?: string | null; className?: string }) {
  const text = label?.trim() || null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${className}`.trim()}
      style={{ backgroundColor: 'var(--btn-primary-bg, var(--color-primary))', color: 'var(--btn-primary-text, #fff)', fontFamily: 'var(--font-body)' }}
      data-featured-badge=""
    >
      <span aria-hidden="true">★</span>
      {text}
    </span>
  )
}
