'use client'

import type { ComponentProps, ReactNode } from 'react'

const SPARKLE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z" />
  </svg>
)

/**
 * A writing-helper action ("Suggest a title", "Improve the text", "Write
 * alt text"): AI as an assistant, never the main action. The icon pulses and
 * aria-busy is set while it works; `badge` marks one that is not available
 * yet ("Soon").
 *
 *   <AssistButton busy={busy} onClick={suggest}>{busy ? t('thinking') : t('suggest')}</AssistButton>
 *
 * tone: accent (the highlighted helper, default) or outline (secondary helpers
 * in a row). The shape follows the surface like Button.
 */
export function AssistButton({
  busy = false,
  icon = SPARKLE,
  badge,
  tone = 'accent',
  className = '',
  children,
  type = 'button',
  ...rest
}: {
  busy?: boolean
  icon?: ReactNode
  badge?: ReactNode
  tone?: 'accent' | 'outline'
  children: ReactNode
} & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--button-radius,0.75rem)] border px-4 text-[0.9375rem] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${
        tone === 'accent' ? 'border-transparent bg-accent text-accent-foreground enabled:hover:bg-hover' : 'border-border bg-background text-foreground enabled:hover:bg-hover'
      } ${className}`}
      {...rest}
    >
      <span className={busy ? 'animate-pulse motion-reduce:animate-none' : undefined}>{icon}</span>
      {children}
      {badge ? <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">{badge}</span> : null}
    </button>
  )
}
