/**
 * A small round number next to a label ("Details ②": things to fix on a tab,
 * unread items on a nav entry). The number is shown, `srLabel` is what a
 * screen reader hears ("2 things to fix") — always pass it. Readable on the
 * selected (action-coloured) segment too.
 *
 *   <span className="inline-flex items-center gap-1.5">{label}<CountBadge count={2} srLabel={t('tabCount', { count: 2 })} /></span>
 */
export function CountBadge({ count, srLabel }: { count: number; srLabel: string }) {
  return (
    <>
      <span aria-hidden="true" className="grid h-5 min-w-5 place-items-center rounded-full border border-foreground bg-background px-1.5 text-[0.75rem] leading-5 font-semibold text-foreground tabular-nums">
        {count}
      </span>
      <span className="sr-only">{srLabel}</span>
    </>
  )
}
