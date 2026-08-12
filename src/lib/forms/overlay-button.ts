/**
 * Form overlay button — ADR-018 slice 7b.
 *
 * Pure presentation helpers for the `formOverlayButtonSection` — a page button
 * that opens a definition-driven form as an overlay. Kept separate from the
 * slice-7a `overlay.ts` core (already shipped) so that file stays untouched;
 * these are only the class-name mappings, unit-tested without rendering.
 *
 * Styling uses the same Design System CSS variables the form renderers consume,
 * so the button inherits each tenant's theme.
 */

export type OverlayButtonStyle = 'primary' | 'secondary'
export type OverlayButtonAlign = 'left' | 'center' | 'right'

/** Flex-justify class for the button's container row. Defaults to centered. */
export function overlayButtonAlignClass(align?: OverlayButtonAlign | null): string {
  switch (align) {
    case 'left':
      return 'justify-start'
    case 'right':
      return 'justify-end'
    case 'center':
    default:
      return 'justify-center'
  }
}

/** Button class string for the chosen style. Defaults to the primary (filled) look. */
export function overlayButtonClass(style?: OverlayButtonStyle | null): string {
  const base =
    'inline-flex items-center justify-center px-6 py-3 rounded-[var(--radius-md)] text-sm font-medium transition-opacity hover:opacity-90'
  if (style === 'secondary') {
    return `${base} border border-[var(--border)] bg-transparent text-[var(--text-primary)]`
  }
  return `${base} bg-[var(--primary)] text-[var(--btn-primary-text,#fff)]`
}
