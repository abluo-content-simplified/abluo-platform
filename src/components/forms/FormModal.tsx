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

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return
    const container = containerRef.current

    const getFocusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
        (el) => !el.closest('[aria-hidden="true"]'),
      )

    ;(getFocusables()[0] ?? container).focus()

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const elements = getFocusables()
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === container) {
          e.preventDefault()
          last.focus()
        }
      } else if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [isActive, containerRef])
}

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

export function FormModal({ isOpen, onClose, closeLabel, title, eyebrow, children }: FormModalProps) {
  const dialogId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useFocusTrap(panelRef, isOpen)

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Body scroll lock while open.
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — visual only; does NOT close (parity with EarlyAccessModal). */}
          <motion.div
            key="form-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[500] bg-black/45 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            key="form-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? `${dialogId}-title` : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-1/2 z-[510] mx-auto max-w-lg -translate-y-1/2 rounded-2xl shadow-2xl backdrop-blur-[24px] saturate-150 md:inset-x-auto md:left-1/2 md:-translate-x-1/2"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-background, var(--background)) 90%, transparent)',
              border: '1px solid var(--color-border, var(--border))',
              maxHeight: 'calc(100dvh - 2rem)',
              overflowY: 'auto',
              outline: 'none',
            }}
          >
            {/* Header — sticky, holds optional eyebrow/title + the close button. */}
            <div
              className="sticky top-0 z-10 flex items-start justify-between gap-4 px-6 pt-6 pb-5 backdrop-blur-[24px] saturate-150"
              style={{
                backgroundColor:
                  'color-mix(in oklch, var(--color-background, var(--background)) 88%, transparent)',
                borderBottom:
                  '1px solid color-mix(in oklch, var(--color-border, var(--border)) 50%, transparent)',
              }}
            >
              <div className="flex flex-col gap-1.5 pr-2">
                {eyebrow && (
                  <p
                    className="text-[10px] font-bold uppercase tracking-[0.12em]"
                    style={{ color: 'var(--color-primary, var(--primary))' }}
                  >
                    {eyebrow}
                  </p>
                )}
                {title && (
                  <h2
                    id={`${dialogId}-title`}
                    className="text-lg font-semibold"
                    style={{
                      color: 'var(--color-text-primary, var(--text-primary))',
                      fontFamily: 'var(--font-heading)',
                    }}
                  >
                    {title}
                  </h2>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                title={closeLabel}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{
                  color: 'var(--color-text-muted, var(--text-secondary))',
                  backgroundColor:
                    'color-mix(in oklch, var(--color-border, var(--border)) 50%, transparent)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body — the form renderer. */}
            <div className="px-6 pb-8 pt-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
