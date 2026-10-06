'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

/** A calm confirmation sheet for irreversible actions (discard / delete). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('clientDashboard.create.confirm')
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="confirm-title"
      className="m-auto mb-0 w-full max-w-md rounded-t-2xl bg-popover p-6 pb-[max(24px,env(safe-area-inset-bottom))] text-popover-foreground backdrop:bg-overlay md:mb-auto md:rounded-2xl"
    >
      <h2 id="confirm-title" className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-2 text-[0.9375rem] leading-6 text-muted-foreground">{body}</p>
      <p role="alert" className="mt-2 min-h-5 text-sm text-destructive">
        {error}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-xl bg-action px-5 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-12 flex-1 items-center justify-center rounded-xl border border-border px-5 text-[0.9375rem] font-semibold text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('cancel')}
        </button>
      </div>
    </dialog>
  )
}
