'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { iconButtonClass } from './button-styles'
import type { DropEdge, GripProps } from './use-pointer-drag'

/**
 * The ⋮⋮ handle for reordering a list. Drag it with a mouse or a finger
 * (spread `drag.gripProps(key)` into `drag` — see usePointerDrag), or focus it
 * and press ArrowUp / ArrowDown to move the row one place; focus stays on the
 * grip and the new position is announced. The row carries
 * `{...drag.rowProps(key)}` and shows the drop indicator (DropLine, or
 * dropEdgeClass on a table row).
 *
 * `label` names the row AND its position, e.g. "Move Pizza, position 2 of 5.
 * Drag, or use the up and down arrow keys." — it is re-read after each move.
 *
 *   <DragGrip label={t('drag', { name, position: n + 1, total })} drag={drag.gripProps(key)}
 *     onMove={(dir) => move(key, dir)} />
 */
export function DragGrip({
  label,
  drag,
  onMove,
  disabled,
  className = '',
}: {
  label: string
  drag: GripProps
  /** Keyboard reorder: -1 = up one place, 1 = down one place. Omit when the list offers no keyboard path. */
  onMove?: (direction: -1 | 1) => void
  disabled?: boolean
  className?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const [announce, setAnnounce] = useState(false)

  // A reorder moves the row in the DOM, which can drop focus; give it back.
  useEffect(() => {
    if (refocus.current) {
      refocus.current = false
      if (ref.current && document.activeElement !== ref.current) ref.current.focus()
    }
  })

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    drag.onKeyDown(e)
    if (!onMove || disabled) return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    refocus.current = true
    setAnnounce(true)
    onMove(e.key === 'ArrowUp' ? -1 : 1)
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled}
        {...drag}
        onKeyDown={onKeyDown}
        onBlur={() => setAnnounce(false)}
        className={iconButtonClass(`cursor-grab active:cursor-grabbing ${className}`.trim())}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
        </svg>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announce ? label : ''}
      </span>
    </>
  )
}

/** The drop indicator on a card-like row: a rule above or below it. The row must be `relative`. */
export function DropLine({ edge }: { edge: DropEdge | null }) {
  if (!edge) return null
  return <span aria-hidden="true" className={`pointer-events-none absolute inset-x-3 h-0.5 rounded bg-action ${edge === 'after' ? '-bottom-2' : '-top-2'}`} />
}
