import { useFormatter } from 'next-intl'

export type RankedItem = { label: string; value: number; /** Optional muted text after the value (e.g. a share). */ detail?: string }

/**
 * Label + value + a thin proportional bar (ADR-029 §4): top pages, search
 * queries, channels. The bar is relative to the first (largest) item; the
 * number is always written, so the bar is never the only signal. One colour
 * (the app's primary), 4px tall with rounded ends, on a muted track.
 *
 *   <RankedList label="Top pages" items={[{ label: '/', value: 2000 }, …]} />
 */
export function RankedList({ items, label, max }: { items: readonly RankedItem[]; label: string; /** Show at most this many. */ max?: number }) {
  const format = useFormatter()
  const shown = max ? items.slice(0, max) : items
  const top = Math.max(1, ...shown.map((i) => i.value))
  return (
    <ol aria-label={label} className="flex flex-col gap-3">
      {shown.map((item, i) => (
        <li key={`${item.label}-${i}`} className="flex flex-col gap-1.5">
          <span className="flex items-start justify-between gap-3 text-sm leading-5">
            <span className="min-w-0 truncate text-foreground" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {format.number(item.value)}
              {item.detail ? <span className="ml-1.5 text-muted-foreground">{item.detail}</span> : null}
            </span>
          </span>
          <span aria-hidden="true" className="block h-1 w-full overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (item.value / top) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}
