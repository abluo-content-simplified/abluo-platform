import type { ComponentProps } from 'react'

/**
 * The floating panel of a small popover anchored to a control (e.g. the
 * "feature this post" star): popover colours, raised shadow, rounded. The
 * caller positions it (anchored-popover.ts) and owns role / focus / closing.
 * A list of actions is CardMenu; a short task is BottomSheet.
 */
export function PopoverPanel({ className = '', ...rest }: ComponentProps<'div'>) {
  return <div className={`z-50 rounded-2xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-[var(--shadow-raise)] ${className}`} {...rest} />
}
