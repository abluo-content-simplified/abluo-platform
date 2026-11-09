'use client'

import type { MouseEvent } from 'react'

/**
 * "+3": the small chip after a shortened list in a row or card (a course's
 * classes, a person's groups) that shows the rest IN PLACE, and "Show fewer"
 * again on the next click. It is its own button inside a clickable row: the
 * click never reaches the row (no navigation), Enter / Space work, and
 * `aria-expanded` says whether the rest is shown. The visual is a 1.5rem chip;
 * the hit area is 2.75rem.
 *
 *   <MoreToggle count={3} expanded={open} onToggle={() => setOpen(!open)}
 *     label={open ? t('showFewer') : t('showAll', { count: 5 })} controls="row-7-classes" />
 */
export function MoreToggle({
  count,
  expanded,
  onToggle,
  label,
  lessText = '−',
  controls,
}: {
  /** How many are hidden ("+3"). */
  count: number
  expanded: boolean
  onToggle: () => void
  /** The accessible name — what pressing it does ("Show all 5 classes" / "Show fewer"). */
  label: string
  /** The chip's text while expanded (default "−"). */
  lessText?: string
  /** id of the element whose content it expands. */
  controls?: string
}) {
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    onToggle()
  }
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={press}
      className="relative inline-flex h-6 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-muted px-2 text-xs leading-6 font-semibold text-foreground tabular-nums transition-colors duration-200 before:absolute before:-inset-x-1.5 before:-inset-y-2.5 before:content-[''] hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
    >
      {expanded ? lessText : `+${count}`}
    </button>
  )
}
