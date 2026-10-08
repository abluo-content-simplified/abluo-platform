'use client'

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useExitContent } from './use-exit-content'
import { useSheetDialog } from './use-sheet-dialog'

/**
 * A detail panel for one list item (a form request, a person, an order …),
 * on a native modal <dialog> so focus, Esc and the backdrop just work.
 * Computers (md+): a drawer on the right, full height, up to 40rem wide — the
 * list stays visible behind it. Phones: a bottom sheet up to 90% of the screen.
 * The header (title, subtitle, close) and the `actions` row stay put; the body
 * scrolls. For short choices use BottomSheet; this is for reading.
 *
 *   <SidePanel open={!!row} title={row.name} subtitle={row.email} closeLabel="Close"
 *     onClose={() => setOpen(null)} actions={<StatusSelect … />}>
 *     <SubmissionDetail … />
 *   </SidePanel>
 */
export function SidePanel({
  open,
  title,
  subtitle,
  closeLabel,
  onClose,
  actions,
  children,
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  /** Accessible name of the close button. */
  closeLabel: string
  onClose: () => void
  /** Under the header, not scrolling: e.g. a status control and buttons. */
  actions?: ReactNode
  children: ReactNode
}) {
  const body = useExitContent(open, children)
  const head = useExitContent(open, title)
  const sub = useExitContent(open, subtitle ?? null)
  const acts = useExitContent(open, actions ?? null)
  const { target, dialogProps } = useSheetDialog(open, onClose)
  if (!target) return null
  return createPortal(
    <dialog
      {...dialogProps}
      // A click on the backdrop (the dialog element itself, outside its box) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-labelledby="side-panel-title"
      className="app-panel m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-popover p-0 text-popover-foreground shadow-[var(--shadow-raise)] backdrop:bg-overlay open:flex open:flex-col md:mt-0 md:ml-auto md:h-dvh md:max-h-dvh md:w-[40rem] md:max-w-[calc(100vw-2rem)] md:rounded-none md:rounded-l-2xl"
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-border p-4 md:px-6">
        <div className="min-w-0 flex-1 pt-1.5">
          <h2 id="side-panel-title" className="truncate text-lg leading-7 font-semibold">
            {head}
          </h2>
          {sub ? <p className="truncate text-[0.9375rem] leading-6 text-muted-foreground">{sub}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {acts ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-6">{acts}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6">{body}</div>
    </dialog>,
    target,
  )
}
