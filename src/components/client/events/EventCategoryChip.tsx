import { categorySummary } from './event-category-view'

/**
 * An event's categories in one small chip: the first name, then "+N" for the
 * rest (the same chip look as the Posts list). Screen readers hear every name
 * through `label` ("Categories: Yoga, Retreats"). Nothing when there are none.
 */
export function EventCategoryChip({ names, label }: { names: readonly string[]; label: string }) {
  const { first, more } = categorySummary(names)
  if (first === null) return null
  return (
    <span className="flex w-full min-w-0 flex-nowrap items-start gap-1 overflow-hidden" title={names.join(', ')}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="block h-6 min-w-0 truncate rounded-md bg-muted px-2 text-xs leading-6 text-muted-foreground">
        {first}
      </span>
      {more > 0 ? (
        <span aria-hidden="true" className="block h-6 shrink-0 rounded-md bg-muted px-2 text-xs leading-6 text-muted-foreground">
          +{more}
        </span>
      ) : null}
    </span>
  )
}
