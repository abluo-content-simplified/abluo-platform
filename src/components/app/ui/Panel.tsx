import type { ReactNode } from 'react'

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
  className = '',
  children,
  ...aria
}: {
  as?: 'div' | 'section' | 'article' | 'aside'
  padding?: 'none' | 'md' | 'lg'
  tone?: 'card' | 'muted'
  className?: string
  children: ReactNode
  id?: string
  'aria-labelledby'?: string
  'aria-label'?: string
}) {
  const pad = padding === 'lg' ? 'p-6' : padding === 'md' ? 'p-4' : ''
  const fill = tone === 'muted' ? 'bg-muted' : 'bg-card'
  return (
    <Tag className={`rounded-2xl border border-border ${fill} ${pad} ${className}`} {...aria}>
      {children}
    </Tag>
  )
}
