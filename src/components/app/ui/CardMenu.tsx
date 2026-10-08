'use client'

import { useCallback, useId, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from './anchored-popover'
import { CellIconButton } from './list/cells'
import { OVERLAY_CHIP } from './list/overlay-chip'

export type CardMenuItem = { key: string; label: string; onSelect: () => void; destructive?: boolean; href?: string }

/**
 * The ⋯ button on a card (44px) and its small menu. The menu renders in a
 * portal with fixed positioning (so scroll containers such as the Posts table
 * never clip it), opens under the button or above it when there is no room,
 * and closes on Escape (focus back to ⋯), a press outside, scroll, resize and
 * after a choice. `variant`: 'cell' = a 1.5rem visual on a table cell line
 * (CellIconButton), 'chip' = a 2rem overlay chip on card media.
 */
const DOTS = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </svg>
)

export function CardMenu({ label, items, variant = 'default' }: { label: string; items: CardMenuItem[]; variant?: 'default' | 'cell' | 'chip' }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const dismiss = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])
  useAnchoredPopover({ open, anchorRef: buttonRef, panelRef: menuRef, align: 'right', onDismiss: dismiss })
  if (!items.length) return null
  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setTarget(portalTarget(e.currentTarget))
    setOpen((o) => !o)
  }
  return (
    <div className="relative shrink-0">
      {variant === 'cell' ? (
        <CellIconButton
          ref={buttonRef}
          label={label}
          icon={DOTS}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
          className="text-foreground"
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
          className={`${
            variant === 'chip' ? `${OVERLAY_CHIP} transition-colors duration-200 hover:bg-background` : 'grid size-11 place-items-center rounded-full text-foreground hover:bg-hover'
          } focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
        >
          {DOTS}
        </button>
      )}
      {open && target
        ? createPortal(
            <ul
              ref={menuRef}
              id={id}
              style={FLOATING_STYLE}
              onClick={(e) => e.stopPropagation()}
              className="z-50 w-60 overflow-hidden rounded-2xl border border-border bg-popover py-1 text-popover-foreground shadow-[var(--shadow-raise)]"
            >
              {items.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      dismiss(false)
                      item.onSelect()
                    }}
                    className={`flex min-h-12 w-full items-center px-4 text-left text-[0.9375rem] hover:bg-hover focus-visible:bg-hover focus-visible:outline-none ${
                      item.destructive ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>,
            target
          )
        : null}
    </div>
  )
}
