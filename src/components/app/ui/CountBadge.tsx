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
 */
export function CountBadge({ count, srLabel, tone = 'outline' }: { count: number; srLabel: string; tone?: 'outline' | 'attention' }) {
  const look =
    tone === 'attention'
      ? 'h-6 min-w-6 bg-attention px-2 text-[0.8125rem] leading-6 font-bold text-attention-foreground'
      : 'h-5 min-w-5 border border-foreground bg-background px-1.5 text-[0.75rem] leading-5 font-semibold text-foreground'
  return (
    <>
      <span aria-hidden="true" className={`grid place-items-center rounded-full tabular-nums ${look}`}>
        {count}
      </span>
      <span className="sr-only">{srLabel}</span>
    </>
  )
}
