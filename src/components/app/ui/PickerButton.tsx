'use client'

import type { ComponentProps, ReactNode } from 'react'

/**
 * The two parts of a "pick one of my sites/items" control that opens a sheet:
 *
 *  - `PickerTrigger`: a select-looking button (name over a quiet second line,
 *    up/down chevron). Pass aria-haspopup / aria-expanded / aria-label.
 *  - `PickerOption`: one 3rem row in the sheet (name over a quiet second line,
 *    a tick when `current`, which also sets aria-current).
 *
 *   <PickerTrigger aria-label="Switch site" aria-haspopup="dialog" aria-expanded={open} onClick={…} secondary={domain}>{name}</PickerTrigger>
 *   <PickerOption current={slug === active} onClick={…} secondary={domain}>{name}</PickerOption>
 */
export function PickerTrigger({
  secondary,
  children,
  type = 'button',
  ...rest
}: Omit<ComponentProps<'button'>, 'className'> & { secondary?: ReactNode }) {
  return (
    <button
      type={type}
      className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-left transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      {...rest}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{children}</span>
        {secondary ? <span className="block truncate text-xs text-muted-foreground">{secondary}</span> : null}
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground">
        <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
      </svg>
    </button>
  )
}

export function PickerOption({
  current = false,
  secondary,
  children,
  type = 'button',
  ...rest
}: Omit<ComponentProps<'button'>, 'className'> & { current?: boolean; secondary?: ReactNode }) {
  return (
    <button
      type={type}
      aria-current={current ? 'true' : undefined}
      className={`flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none ${current ? 'bg-muted' : ''}`}
      {...rest}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium text-foreground">{children}</span>
        {secondary ? <span className="block truncate text-xs text-muted-foreground">{secondary}</span> : null}
      </span>
      {current ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-foreground">
          <path d="M5 12.5 10 17l9-10" />
        </svg>
      ) : null}
    </button>
  )
}
