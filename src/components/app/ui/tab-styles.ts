/**
 * Tabs class composition (pure, so it is unit-testable without a DOM).
 * Underline tabs: a hairline under the whole row, the selected tab has the
 * action colour under it. The row scrolls sideways on a phone and never wraps.
 */
export const TAB_LIST_CLASS = 'flex max-w-full gap-1 overflow-x-auto border-b border-border'

const TAB_BASE =
  'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-[0.9375rem] font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 transition-colors duration-200 motion-reduce:transition-none'

export function tabClass(selected: boolean): string {
  return `${TAB_BASE} ${selected ? 'border-action text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`
}

/** Ids that tie a tab to its panel: `<base>-tab-<id>` / `<base>-panel-<id>`. */
export function tabIds(base: string, id: string): { tab: string; panel: string } {
  return { tab: `${base}-tab-${id}`, panel: `${base}-panel-${id}` }
}
