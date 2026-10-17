'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { nextSegmentIndex } from './segmented-keys'

export type OptionCard<V extends string> = {
  value: V
  title: ReactNode
  /** Anything under the title: a sentence, a preview, a count. */
  body?: ReactNode
  /** A small note next to the title (e.g. "Soon"). */
  badge?: ReactNode
  disabled?: boolean
}

/**
 * One choice among a few big cards — the Create flow's way of asking a
 * question (which call to action, which gallery, how to handle a language).
 * A card can hold rich content (a preview). radiogroup semantics with roving
 * focus: Tab enters on the chosen card, arrow keys move and choose.
 *
 *   <OptionCards label={t('options')} value={choice} onChange={setChoice}
 *     options={[{ value: 'none', title: t('none'), body: t('noneHelp') }, …]} />
 *
 * layout: stack (one card per row, default) or row (cards side by side from
 * sm up — short options like "Translate / Write / Later"). Forms on manage
 * screens use RadioList; icon tiles use ChoiceCard.
 */
export function OptionCards<V extends string>({
  label,
  value,
  onChange,
  options,
  layout = 'stack',
  className = '',
}: {
  label: string
  value: V | null
  onChange: (value: V) => void
  options: OptionCard<V>[]
  layout?: 'stack' | 'row'
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((o) => o.value === value)
  const stop = selected >= 0 && !options[selected].disabled ? selected : options.findIndex((o) => !o.disabled)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = refs.current.findIndex((b) => b === document.activeElement)
    if (current < 0) return
    const next = nextSegmentIndex(e.key, current, options.map((o) => !!o.disabled))
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  const grid = layout === 'row' ? 'grid grid-cols-1 gap-2 sm:grid-flow-col sm:auto-cols-fr' : 'flex flex-col gap-3'
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={`${grid} ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        const compact = layout === 'row'
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === stop ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`flex w-full border-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground ${
              compact ? 'min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] font-medium' : 'min-h-16 flex-col items-start gap-1 rounded-2xl px-4 py-3'
            } ${on ? 'border-foreground bg-selected-tint' : 'border-border enabled:hover:bg-hover'}`}
          >
            <span className={`flex items-center gap-2 ${compact ? '' : 'text-[1.0625rem] font-semibold text-foreground'}`}>
              {o.title}
              {o.badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{o.badge}</span> : null}
            </span>
            {o.body ? <span className="w-full text-[0.9375rem] leading-6 text-muted-foreground">{o.body}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
