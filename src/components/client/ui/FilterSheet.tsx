'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { useTranslations } from 'next-intl'

/**
 * Phone filters. A "Filters · 2" trigger opens a bottom sheet that slides up,
 * drags down by its handle to close (25% of its height or a fast flick), and
 * closes on backdrop tap and Escape. Put the filter controls in `children`.
 *
 *   <FilterSheet activeCount={2} resultCount={14} onClearAll={reset}>
 *     <FilterSelect … /> <DateRangePicker … />
 *   </FilterSheet>
 *   <AppliedFilterChips chips={[{ id: 'status', label: 'Published' }]}
 *     onRemove={(id) => …} onClearAll={reset} />
 */

const BTN =
  'inline-flex h-11 items-center justify-center rounded-xl px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const CLOSE_MS = 220

export function FilterSheet({
  activeCount,
  resultCount,
  onClearAll,
  children,
  title,
  open: openProp,
  onOpenChange,
  className = '',
}: {
  /** Number of active filters, shown as "Filters · N" on the trigger. */
  activeCount: number
  /** Results with the current filters, shown on the "Show N results" button. */
  resultCount: number
  onClearAll: () => void
  /** The filter controls. */
  children: ReactNode
  title?: string
  /** Optional controlled open state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const t = useTranslations('clientDashboard.ui.filterSheet')
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = useCallback(
    (o: boolean) => {
      setOpenState(o)
      onOpenChange?.(o)
    },
    [onOpenChange]
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const heading = title ?? t('title')

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:w-auto ${className}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
        {activeCount > 0 ? t('filtersCount', { count: activeCount }) : t('filters')}
      </button>
      {open && (
        <Sheet
          title={heading}
          resultCount={resultCount}
          onClearAll={onClearAll}
          onClosed={() => {
            setOpen(false)
            triggerRef.current?.focus()
          }}
        >
          {children}
        </Sheet>
      )}
    </>
  )
}

function Sheet({
  title,
  resultCount,
  onClearAll,
  onClosed,
  children,
}: {
  title: string
  resultCount: number
  onClearAll: () => void
  onClosed: () => void
  children: ReactNode
}) {
  const t = useTranslations('clientDashboard.ui.filterSheet')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; t: number; id: number } | null>(null)
  const closing = useRef(false)

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (!d.open) d.showModal()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const id = requestAnimationFrame(() => setShown(true))
    return () => {
      cancelAnimationFrame(id)
      document.body.style.overflow = prev
      if (d.open) d.close()
    }
  }, [])

  const requestClose = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setDrag(null)
    setShown(false)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.setTimeout(onClosed, reduce ? 0 : CLOSE_MS)
  }, [onClosed])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId }
    setDrag(0)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    setDrag(Math.max(0, e.clientY - start.current.y))
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = start.current
    start.current = null
    if (!s) return
    const dy = Math.max(0, e.clientY - s.y)
    const height = panelRef.current?.offsetHeight ?? 1
    const velocity = dy / Math.max(1, e.timeStamp - s.t)
    if (!cancelled && (dy > height * 0.25 || (velocity > 0.6 && dy > 24))) requestClose()
    else setDrag(null)
  }

  const transform = drag !== null ? `translateY(${drag}px)` : shown ? 'translateY(0)' : 'translateY(100%)'

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        requestClose()
      }}
      onClose={() => {
        if (!closing.current) onClosed()
      }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-0 text-popover-foreground backdrop:bg-transparent"
    >
      <div
        aria-hidden="true"
        onClick={requestClose}
        className={`absolute inset-0 bg-overlay transition-opacity duration-200 ease-out motion-reduce:transition-none ${shown && drag === null ? 'opacity-100' : shown ? 'opacity-70' : 'opacity-0'}`}
      />
      <div
        ref={panelRef}
        style={{ transform }}
        className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-2xl bg-popover shadow-[var(--shadow-raise)] ${
          drag === null ? 'transition-transform duration-[220ms] ease-out motion-reduce:transition-none' : ''
        }`}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
          aria-label={t('dragHandle')}
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 active:cursor-grabbing"
        >
          <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-border" />
          <div className="flex w-full items-start justify-between gap-3 pr-2 pl-4">
            <h2 className="pt-2 text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={requestClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={t('close')}
              className="grid size-11 place-items-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-3 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">{children}</div>
        <div className="flex shrink-0 items-center gap-2 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClearAll} className={`${BTN} text-foreground hover:bg-hover`}>
            {t('clearAll')}
          </button>
          <button type="button" onClick={requestClose} className={`${BTN} flex-1 bg-action text-action-foreground hover:opacity-90`}>
            {t('showResults', { count: resultCount })}
          </button>
        </div>
      </div>
    </dialog>
  )
}

export type FilterChip = { id: string; label: string }

/** Row of removable chips for the active filters; render above the list while the sheet is closed. */
export function AppliedFilterChips({
  chips,
  onRemove,
  onClearAll,
  className = '',
}: {
  chips: FilterChip[]
  onRemove: (id: string) => void
  onClearAll: () => void
  className?: string
}) {
  const t = useTranslations('clientDashboard.ui.filterSheet')
  if (chips.length === 0) return null
  return (
    <div role="group" aria-label={t('applied')} className={`flex items-start gap-2 overflow-x-auto pb-1 ${className}`}>
      {chips.map((c) => (
        <span key={c.id} className="inline-flex h-11 shrink-0 items-center rounded-full border border-border bg-muted pl-4 text-[0.9375rem] text-foreground">
          {c.label}
          <button
            type="button"
            onClick={() => onRemove(c.id)}
            aria-label={t('remove', { label: c.label })}
            className="grid size-11 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className={`${BTN} shrink-0 text-foreground hover:bg-hover`}>
        {t('clearAll')}
      </button>
    </div>
  )
}
