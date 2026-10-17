/**
 * Button class composition (pure, so it is unit-testable without a DOM).
 *
 * Derived from the four ad-hoc sets this replaces (D1 of the component audit):
 *   CAT_BUTTON/CAT_PRIMARY, EVENT_BUTTON/EVENT_PRIMARY, PRIMARY_BTN/QUIET_BTN
 *   (people), PRIMARY_BUTTON/SECONDARY_BUTTON/DESTRUCTIVE_BUTTON (backlog).
 *
 * Majority choices:
 *  - h-11 / rounded-xl / px-4 / text-[0.9375rem] / gap-2 / justify-center (all four)
 *  - primary + secondary are font-semibold (catalogue + events), quiet +
 *    destructive font-medium (people + backlog)
 *  - ONE disabled style: opacity-40 (catalogue, events, people; backlog used 60),
 *    and the hover treatment is switched off while disabled
 *  - primary keeps the ring offset and hover:opacity-90
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive'
export type ButtonSize = 'md' | 'lg'

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-[0.9375rem] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-action font-semibold text-action-foreground hover:opacity-90 focus-visible:ring-offset-2 disabled:hover:opacity-40',
  secondary: 'border border-border font-semibold text-foreground hover:bg-hover disabled:hover:bg-transparent',
  quiet: 'font-medium text-foreground hover:bg-hover disabled:hover:bg-transparent',
  destructive: 'border border-border font-medium text-destructive hover:bg-hover disabled:hover:bg-transparent',
}

/** md: the 44px default. lg: the 48px sheet/footer action (pair with `fullWidth` where it spans the sheet). */
const SIZE: Record<ButtonSize, string> = {
  md: 'h-11 px-4',
  lg: 'h-12 px-5',
}

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}): string {
  return [BASE, VARIANT[variant], SIZE[size], fullWidth ? 'w-full' : '', className].filter(Boolean).join(' ')
}

/**
 * Icon-only button: a 44px square, no border (the CAT_ICON_BUTTON it replaces,
 * byte for byte). Disabled is fainter (30%) than a text button, because a
 * disabled arrow next to an enabled one must read as clearly unavailable.
 */
const ICON_BASE =
  'grid size-11 shrink-0 place-items-center rounded-xl text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30'

export function iconButtonClass(className = ''): string {
  return className ? `${ICON_BASE} ${className}` : ICON_BASE
}
