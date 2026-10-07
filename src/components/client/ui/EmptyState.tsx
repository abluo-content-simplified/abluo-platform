import type { ReactNode } from 'react'

/**
 * The one empty / "nothing here yet" message for client pages: a calm dashed
 * box with a title, an optional line of explanation and an optional action.
 * Top-aligned and left-aligned, like every other block.
 *
 *   <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
 */
export function EmptyState({
  title,
  body,
  action,
  titleAs: Title = 'h2',
  compact = false,
  className = '',
}: {
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
  /** The title's element: h2 when the empty state is the block, p inside an already-headed section. */
  titleAs?: 'h2' | 'h3' | 'p'
  /** Less padding, for an empty state inside a dashboard block. */
  compact?: boolean
  className?: string
}) {
  return (
    <div className={`flex flex-col items-start gap-2 rounded-2xl border border-dashed border-border ${compact ? 'px-4 py-4' : 'p-6'} ${className}`}>
      <Title className="text-[1.0625rem] leading-6 font-semibold text-foreground">{title}</Title>
      {body ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
