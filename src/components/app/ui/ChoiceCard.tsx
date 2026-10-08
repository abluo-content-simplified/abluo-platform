'use client'

import type { ReactNode } from 'react'

/**
 * ChoiceCard (Abluo App design system): a large tappable card answering a
 * question with one icon (top-left) and one short label (bottom-left).
 *
 *   <ChoiceCardGrid label="What would you like to create?">
 *     <ChoiceCard icon={<PenIcon />} label="Blog post" onSelect={() => start('blog')} />
 *   </ChoiceCardGrid>
 *
 * Two kinds:
 *   • a choice (`selected` given): `role="radio"` + aria-checked, inside a
 *     `ChoiceCardGrid kind="radio"` (role="radiogroup");
 *   • a menu of actions (`selected` omitted): plain buttons, grid `kind="menu"`.
 *
 * Layout: 2 columns on phones, 3 from 640px, gap 0.75rem. Card: min height
 * 7.5rem, padding 1.25rem, radius-xl, flex column justify-between; icon
 * ~30px (stroke 1.5), label 17px / 22px, weight 500. States: rest = 1px
 * border on bg-card; selected = 2px foreground border + bg-muted (padding
 * −1px, nothing shifts); hover (devices that hover) = bg-accent; focus = 2px
 * ring with a 2px offset.
 */
export function ChoiceCardGrid({
  label,
  kind = 'menu',
  children,
  className = '',
}: {
  /** Accessible name of the group (the question). */
  label?: string
  kind?: 'radio' | 'menu'
  children: ReactNode
  className?: string
}) {
  return (
    <div role={kind === 'radio' ? 'radiogroup' : 'group'} aria-label={label} className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${className}`}>
      {children}
    </div>
  )
}

export function ChoiceCard({
  icon,
  label,
  onSelect,
  selected,
  disabled = false,
  busy = false,
  badge,
}: {
  /** One icon, drawn at ~30px with a 1.5 stroke. */
  icon: ReactNode
  /** One short label. */
  label: string
  onSelect?: () => void
  /** Given → a radio choice (aria-checked). Omitted → an action button. */
  selected?: boolean
  disabled?: boolean
  busy?: boolean
  /** A small note in the top-right corner (e.g. "Coming soon"). */
  badge?: ReactNode
}) {
  const radio = selected !== undefined
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`relative flex min-h-[7.5rem] flex-col items-start justify-between rounded-xl text-left text-foreground transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground motion-reduce:transition-none ${
        selected ? 'border-2 border-foreground bg-muted p-[calc(1.25rem-1px)]' : 'border border-border bg-card p-5 enabled:hover:bg-accent'
      }`}
    >
      <span aria-hidden="true" className="grid size-[1.875rem] place-items-center [&>svg]:size-[1.875rem]">
        {icon}
      </span>
      {badge ? (
        <span className="absolute top-3 right-3 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{badge}</span>
      ) : null}
      <span className="mt-3 text-[1.0625rem] leading-[1.375rem] font-medium">{label}</span>
    </button>
  )
}
