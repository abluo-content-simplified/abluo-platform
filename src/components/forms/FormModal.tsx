'use client'

/**
 * FormModal — ADR-018 slice 7a.
 *
 * Generic overlay shell that hosts an arbitrary form body. This is the
 * proven modal mechanics from `EarlyAccessModal` — portal, focus trap,
 * body-scroll lock, Escape-to-close, and the Livener glass panel recipe —
 * extracted so ANY definition-driven form can be presented as an overlay,
 * not just Early Access. It renders `children` (a form renderer) inside the
 * panel and knows nothing about form state itself.
 *
 * Deliberate behavior parity with EarlyAccessModal:
 *   • Backdrop click does NOT close — a multi-step flow must not lose progress
 *     to a stray click. Close is via the X button or Escape only.
 *   • Focus is trapped while open; Escape closes; body scroll is locked.
 *
 * Appearance uses the same Design System tokens the rest of the site consumes,
 * so the overlay inherits each tenant's theme with no styling of its own.
 */

import type { ReactNode } from 'react'
import { SiteDialog } from '@/components/site/SiteDialog'

// The mechanics moved to SiteDialog (shared with every website overlay); the
// focus trap is re-exported for existing importers.
export { useFocusTrap } from '@/components/site/SiteDialog'

interface FormModalProps {
  isOpen: boolean
  onClose: () => void
  /** Accessible label for the close button (localized by the caller). */
  closeLabel: string
  /** Optional overlay heading; when absent the header collapses to just the X. */
  title?: string | null
  /** Optional eyebrow above the title (e.g. a short CTA/context label). */
  eyebrow?: string | null
  children: ReactNode
}

/** Form overlay. Backdrop click does NOT close (a multi-step flow must not lose progress). */
export function FormModal(props: FormModalProps) {
  return <SiteDialog {...props} />
}
