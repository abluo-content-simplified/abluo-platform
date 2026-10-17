'use client'

import type { ComponentProps, ReactNode } from 'react'

/**
 * A small 44px pill button: a suggestion ("+ breakfast"), a tag you can
 * remove, a filter you can switch on and off, a small inline action.
 *
 *   <Chip onClick={add}>+ {tag}</Chip>
 *   <Chip selected={on} onClick={toggle}>{tag}</Chip>              // aria-pressed
 *   <Chip selected removable aria-label={t('remove', { tag })} onClick={remove}>{tag}</Chip>
 *
 * A whole group of on/off choices is ToggleChips; the active filters above a
 * list are AppliedFilterChips; a status is a Pill.
 */
export function Chip({
  selected,
  removable = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: {
  /** Given → a toggle (aria-pressed); true draws the selected tint. */
  selected?: boolean
  /** Shows an × after the label; pass an aria-label that says what is removed. */
  removable?: boolean
  children: ReactNode
} & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type={type}
      aria-pressed={selected === undefined || removable ? undefined : selected}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 ${
        selected ? 'border-ring bg-selected-tint' : 'border-border bg-background enabled:hover:bg-hover'
      } ${className}`}
      {...rest}
    >
      {children}
      {removable ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      ) : null}
    </button>
  )
}
