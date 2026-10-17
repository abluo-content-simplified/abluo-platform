import type { ReactNode } from 'react'
import { IconButton } from './Button'

export type NoticeTone = 'neutral' | 'info' | 'error'

const TONE: Record<NoticeTone, string> = {
  neutral: 'border-border text-foreground',
  info: 'border-border bg-muted text-foreground',
  error: 'border-destructive text-destructive',
}

/**
 * An inline message box inside a page, sheet or form: a load error, a warning
 * that something is in use, a note that explains why an action is blocked.
 * Replaces the hand-written `rounded-2xl border px-4 py-3` boxes.
 *
 *   <Notice tone="error">{t('loadError')}</Notice>
 *   <Notice tone="info" title={t('inUse')} action={<Button …/>} onDismiss={close} dismissLabel={t('dismiss')}>…</Notice>
 *
 * Tones: neutral (border only), info (muted fill), error (destructive). An
 * error is announced (role="alert"); the others are polite (role="status").
 * A one-line error under a single control is <FieldError>, not a Notice. A
 * passing confirmation is a <Toast>.
 */
export function Notice({
  tone = 'neutral',
  title,
  children,
  action,
  onDismiss,
  dismissLabel,
  id,
  className = '',
}: {
  tone?: NoticeTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  /** Pass with `dismissLabel` to show an × in the top-right corner. */
  onDismiss?: () => void
  dismissLabel?: string
  id?: string
  className?: string
}) {
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl border px-4 py-3 text-[0.9375rem] leading-6 ${TONE[tone]} ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className={tone === 'error' ? '' : title ? 'text-muted-foreground' : ''}>{children}</div> : null}
          {action ? <div className="pt-2">{action}</div> : null}
        </div>
        {onDismiss && dismissLabel ? (
          <IconButton className="-mt-2 -mr-2" aria-label={dismissLabel} onClick={onDismiss}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        ) : null}
      </div>
    </div>
  )
}
