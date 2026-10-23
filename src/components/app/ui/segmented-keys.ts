/**
 * Roving-focus keyboard model for a radiogroup (WAI-ARIA): arrows move to the
 * next/previous enabled option and wrap, Home/End jump to the first/last.
 * Returns the index to focus + select, or null when the key is not handled.
 */
export function nextSegmentIndex(key: string, current: number, disabled: readonly boolean[]): number | null {
  const n = disabled.length
  if (n === 0) return null
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0
  if (step !== 0) {
    for (let i = 1; i <= n; i++) {
      const idx = (((current + step * i) % n) + n) % n
      if (!disabled[idx]) return idx
    }
    return null
  }
  if (key === 'Home') {
    const idx = disabled.findIndex((d) => !d)
    return idx === -1 ? null : idx
  }
  if (key === 'End') {
    for (let i = n - 1; i >= 0; i--) if (!disabled[i]) return i
  }
  return null
}

/**
 * solid = page tabs (action colour), soft = list filters (muted fill),
 * pill = the Create flow's view switch (rounded, raised selected segment),
 * chips = one choice among wrapping chips (the Create flow's language picker).
 */
export type SegmentedAppearance = 'solid' | 'soft' | 'pill' | 'chips'

const GROUP: Record<SegmentedAppearance, string> = {
  solid: 'flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border p-1',
  soft: 'flex h-11 w-full max-w-full items-stretch gap-1 overflow-x-auto rounded-xl border border-border bg-background p-1 sm:w-auto',
  pill: 'inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-muted p-1',
  chips: 'flex flex-wrap items-start gap-2',
}
const SEG_BASE = 'rounded-lg font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const SEG: Record<SegmentedAppearance, { base: string; on: string; off: string }> = {
  solid: {
    base: `${SEG_BASE} h-10 shrink-0 px-3.5 text-[0.9375rem] whitespace-nowrap transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none`,
    on: 'bg-action text-action-foreground',
    off: 'text-foreground hover:bg-hover',
  },
  soft: {
    base: `${SEG_BASE} flex-1 px-3 text-[0.9375rem] whitespace-nowrap`,
    on: 'bg-muted text-foreground',
    off: 'text-muted-foreground hover:text-foreground',
  },
  pill: {
    base: 'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
    on: 'bg-background text-foreground shadow-sm',
    off: 'text-muted-foreground hover:text-foreground',
  },
  chips: {
    base: 'inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50',
    on: 'border-foreground bg-selected-tint text-foreground',
    off: 'border-border text-foreground enabled:hover:bg-hover',
  },
}

export function segmentedGroupClass(appearance: SegmentedAppearance, className = ''): string {
  return [GROUP[appearance], className].filter(Boolean).join(' ')
}
export function segmentClass(appearance: SegmentedAppearance, selected: boolean): string {
  const s = SEG[appearance]
  return `${s.base} ${selected ? s.on : s.off}`
}
