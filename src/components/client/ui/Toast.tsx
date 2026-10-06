'use client'

/**
 * One calm toast above the bottom navigation ("Deleted · Undo"). `action`
 * shows a button (Undo). Polite live region; the owner decides when it goes.
 */
export function Toast({
  message,
  action,
  onAction,
  tone = 'status',
}: {
  message: string | null
  action?: string
  onAction?: () => void
  tone?: 'status' | 'error'
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6"
    >
      {message ? (
        <div
          role={tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex min-h-12 max-w-md items-start gap-4 rounded-2xl bg-foreground px-4 py-2 text-[0.9375rem] text-background shadow-[var(--shadow-raise)]"
        >
          <span className="flex-1 py-2.5 leading-6">{message}</span>
          {action && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="inline-flex min-h-11 shrink-0 items-center px-2 font-semibold underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {action}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
