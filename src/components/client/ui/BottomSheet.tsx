'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/** A bottom sheet (native dialog): full width on phones, centred from md. */
export function BottomSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
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
      onClose={onClose}
      aria-label={title}
      className="m-auto mb-0 w-full max-w-md rounded-t-2xl bg-popover p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-popover-foreground backdrop:bg-overlay md:mb-auto md:rounded-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="pt-2 text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={title}
          className="grid size-11 place-items-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex flex-col">{children}</div>
    </dialog>
  )
}
