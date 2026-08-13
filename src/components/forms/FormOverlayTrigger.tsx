'use client'

/**
 * FormOverlayTrigger — ADR-018 slice 7a.
 *
 * A minimal, unstyled-by-default button that opens the form overlay for a given
 * `formId`. It carries no layout opinion — callers pass `className` + children
 * so the same primitive serves a page button (7b) and a global nav CTA (7c).
 *
 * Uses the null-safe hook: if no FormOverlayProvider is mounted (misconfiguration,
 * or a tenant without overlays), it still renders its children but the click is a
 * no-op — a nav link never throws or disappears. In development it warns once so
 * the wiring gap is visible.
 */

import { useFormOverlaySafe } from './FormOverlayContext'

interface FormOverlayTriggerProps {
  /** Which pre-resolved overlay form to open. */
  formId: string
  /** Optional placement Context forwarded to the multi-step renderer. */
  context?: Record<string, unknown> | null
  /** Optional overlay heading override (else the definition's own title). */
  title?: string | null
  /** Optional lead-source seed merged into the submission `source`. */
  source?: Record<string, unknown> | null
  className?: string
  /** Accessible label when children are non-textual (e.g. an icon). */
  'aria-label'?: string
  children: React.ReactNode
}

export function FormOverlayTrigger({
  formId,
  context,
  title,
  source,
  className,
  'aria-label': ariaLabel,
  children,
}: FormOverlayTriggerProps) {
  const overlay = useFormOverlaySafe()

  const handleClick = () => {
    if (!overlay) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          `[FormOverlayTrigger] no FormOverlayProvider in scope — "${formId}" trigger is inert.`,
        )
      }
      return
    }
    overlay.open({ formId, context, title, source })
  }

  return (
    <button type="button" onClick={handleClick} className={className} aria-label={ariaLabel}>
      {children}
    </button>
  )
}
