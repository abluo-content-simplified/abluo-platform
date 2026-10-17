import type { CSSProperties, ReactNode } from 'react'

/**
 * The bordered box around a group of content on a page (a settings block, a
 * summary, a form section). Replaces the hand-written
 * `rounded-2xl border border-border p-4|p-6` boxes so corners, borders and
 * spacing stay the same everywhere.
 *
 *   <Panel>…</Panel>
 *   <Panel as="section" aria-labelledby="h" padding="lg" tone="muted">…</Panel>
 *
 * padding: md = 1rem (default), lg = 1.5rem, none (for a table or list that
 * runs to the edges). tone: card (default) or muted. A clickable card is a
 * ContentCard or LinkCard, not a Panel.
 */
export function Panel({
  as: Tag = 'div',
  padding = 'md',
  tone = 'card',
  highlighted = false,
  style,
  className = '',
  children,
  ...aria
}: {
  as?: 'div' | 'section' | 'article' | 'aside' | 'li'
  padding?: 'none' | 'md' | 'lg'
  /** danger: a destructive border (a group of things that block an action). */
  tone?: 'card' | 'muted' | 'danger'
  /** The action-coloured border (a drop target, the chosen block). */
  highlighted?: boolean
  style?: CSSProperties
  className?: string
  children: ReactNode
  id?: string
  'aria-labelledby'?: string
  'aria-label'?: string
  /** data-* hooks (scroll/focus targets). */
  [data: `data-${string}`]: string | undefined
}) {
  const pad = padding === 'lg' ? 'p-6' : padding === 'md' ? 'p-4' : ''
  const fill = tone === 'muted' ? 'bg-muted' : 'bg-card'
  return (
    <Tag className={`rounded-2xl border ${highlighted ? 'border-action' : tone === 'danger' ? 'border-destructive' : 'border-border'} ${fill} ${pad} ${className}`} style={style} {...aria}>
      {children}
    </Tag>
  )
}
