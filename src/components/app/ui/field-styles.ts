/** Field class composition (pure). Reproduces CAT_INPUT / CAT_TEXTAREA / CAT_LABEL (= EVENT_INPUT / EVENT_LABEL). */
export type ControlSize = 'md' | 'lg'

const INPUT_BASE =
  'w-full rounded-xl border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60'

/** lg: 48px (forms, sheets — the CAT_INPUT height). md: 44px, for inline add/search rows. */
const INPUT_SIZE: Record<ControlSize, string> = { lg: 'h-12', md: 'h-11 min-w-0' }

/** `flush` drops the 6px gap under a label for inputs that are not directly below one. */
export function inputClass({ controlSize = 'lg', flush = false, className = '' }: { controlSize?: ControlSize; flush?: boolean; className?: string } = {}): string {
  return [flush ? '' : 'mt-1.5', INPUT_SIZE[controlSize], INPUT_BASE, className].filter(Boolean).join(' ')
}

export function textAreaClass({ flush = false, className = '' }: { flush?: boolean; className?: string } = {}): string {
  return [flush ? '' : 'mt-1.5', 'min-h-28 py-2.5', INPUT_BASE, className].filter(Boolean).join(' ')
}

export const LABEL_CLASS = 'text-[0.9375rem] font-medium text-foreground'
