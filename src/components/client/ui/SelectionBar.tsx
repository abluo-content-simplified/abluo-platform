'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useSelectionPresence } from './Fab'

/**
 * The floating bar while selecting several cards. Phones: slides up from the
 * bottom, above the tab bar and the safe area. Computers: centred at the
 * bottom of the content area (beside the sidebar). Respects reduced motion.
 */
export function SelectionBar({ label, count, children }: { label: string; count: ReactNode; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  // Phones: the floating "+" steps aside while this panel is up.
  useSelectionPresence(true)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:bottom-6 md:left-56">
      <div
        role="toolbar"
        aria-label={label}
        className={`pointer-events-auto flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-raise)] transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
        }`}
      >
        <p className="px-2 pt-1 text-sm font-semibold" aria-live="polite">
          {count}
        </p>
        <div className="grid auto-cols-fr grid-flow-col gap-1">{children}</div>
      </div>
    </div>
  )
}

/** The ids between two clicked cards (inclusive), in list order — for shift-click. */
export function idRange(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}
