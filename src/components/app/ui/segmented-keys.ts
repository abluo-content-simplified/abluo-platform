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

export type SegmentedAppearance = 'solid' | 'soft'

const GROUP: Record<SegmentedAppearance, string> = {
  solid: 'flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border p-1',
  soft: 'flex h-11 w-full items-stretch gap-1 rounded-xl border border-border bg-background p-1 sm:w-auto',
}
const SEG_BASE = 'rounded-lg font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const SEG: Record<SegmentedAppearance, { base: string; on: string; off: string }> = {
  solid: {
    base: `${SEG_BASE} h-10 shrink-0 px-3.5 text-[0.9375rem] whitespace-nowrap transition-[background-color,border-color,box-shadow,opacity] duration-200 ease-out motion-reduce:transition-none`,
    on: 'bg-action text-action-foreground',
    off: 'text-foreground hover:bg-hover',
  },
  soft: {
    base: `${SEG_BASE} flex-1 px-3 text-[0.9375rem]`,
    on: 'bg-muted text-foreground',
    off: 'text-muted-foreground hover:text-foreground',
  },
}

export function segmentedGroupClass(appearance: SegmentedAppearance, className = ''): string {
  return [GROUP[appearance], className].filter(Boolean).join(' ')
}
export function segmentClass(appearance: SegmentedAppearance, selected: boolean): string {
  const s = SEG[appearance]
  return `${s.base} ${selected ? s.on : s.off}`
}
