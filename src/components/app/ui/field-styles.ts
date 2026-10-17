/** Field class composition (pure). Reproduces CAT_INPUT / CAT_TEXTAREA / CAT_LABEL (= EVENT_INPUT / EVENT_LABEL). */
export type ControlSize = 'md' | 'lg'

const INPUT_BASE =
  'w-full rounded-xl border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-destructive'

/** lg: 48px (forms, sheets — the CAT_INPUT height). md: 44px, for inline add/search rows. */
const INPUT_SIZE: Record<ControlSize, string> = { lg: 'h-12 text-base', md: 'h-11 min-w-0 text-base' }

/** `flush` drops the 6px gap under a label for inputs that are not directly below one. */
export function inputClass({ controlSize = 'lg', flush = false, className = '' }: { controlSize?: ControlSize; flush?: boolean; className?: string } = {}): string {
  return [flush ? '' : 'mt-1.5', INPUT_SIZE[controlSize], INPUT_BASE, className].filter(Boolean).join(' ')
}

/** `sized`: the caller sets the height with `rows`, so no minimum height is added. */
/**
 * Text size of a TextArea: body (default), or the Create flow's big writing
 * fields — title (the post/gallery title) and lead (its subtitle/description).
 */
export type TextAreaSize = 'body' | 'title' | 'lead'
const TEXTAREA_SIZE: Record<TextAreaSize, string> = {
  body: 'text-base',
  title: 'resize-none text-2xl leading-8 font-semibold break-words placeholder:font-normal',
  lead: 'resize-none text-[1.1875rem] leading-7 break-words',
}

export function textAreaClass({ flush = false, sized = false, textSize = 'body', className = '' }: { flush?: boolean; sized?: boolean; textSize?: TextAreaSize; className?: string } = {}): string {
  return [flush ? '' : 'mt-1.5', sized ? 'py-2.5' : 'min-h-28 py-2.5', INPUT_BASE, TEXTAREA_SIZE[textSize], className].filter(Boolean).join(' ')
}

export const LABEL_CLASS = 'text-[0.9375rem] font-medium text-foreground'
