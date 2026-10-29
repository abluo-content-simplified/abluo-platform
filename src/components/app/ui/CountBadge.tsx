/**
 * A small round number next to a label ("Details ②": things to fix on a tab,
 * unread items on a nav entry). The number is shown, `srLabel` is what a
 * screen reader hears ("2 things to fix") — always pass it.
 *
 *   • `outline` (default): readable on the selected (action-coloured) segment too.
 *   • `attention`: filled orange with a bold white number, a little larger —
 *     the sidebar's "something waits for you" badge (both sidebars use it).
 *
 *   <span className="inline-flex items-center gap-1.5">{label}<CountBadge count={2} srLabel={t('tabCount', { count: 2 })} /></span>
 *
 * `overlap` (attention colour, smaller): sits on the top-right corner of its
 * `relative` parent (a tab bar icon), slightly overlapping, absolutely
 * positioned so it never moves the icon, the label or the bar's height.
 *
 *   <span className="relative"><AppIcon d={…} /><CountBadge overlap count={3} srLabel="3 unanswered requests" /></span>
 *
 * The number reads 1–99, then `99+` (`formatBadgeCount`). A count of 0 renders nothing.
 */

/** The text of a badge: 1–99 as is, `99+` from 100. Pure. */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(Math.max(0, Math.trunc(count)))
}

export function CountBadge({
  count,
  srLabel,
  tone = 'outline',
  overlap = false,
}: {
  count: number
  srLabel: string
  tone?: 'outline' | 'attention'
  overlap?: boolean
}) {
  if (count <= 0) return null
  const look = overlap
    ? 'pointer-events-none absolute -top-1.5 -right-2.5 h-[1.125rem] min-w-[1.125rem] bg-attention px-1 text-[0.6875rem] leading-[1.125rem] font-bold text-attention-foreground ring-2 ring-background'
    : tone === 'attention'
      ? 'h-6 min-w-6 bg-attention px-2 text-[0.8125rem] leading-6 font-bold text-attention-foreground'
      : 'h-5 min-w-5 border border-foreground bg-background px-1.5 text-[0.75rem] leading-5 font-semibold text-foreground'
  return (
    <>
      <span aria-hidden="true" className={`grid place-items-center rounded-full tabular-nums ${look}`}>
        {formatBadgeCount(count)}
      </span>
      <span className="sr-only">{srLabel}</span>
    </>
  )
}
