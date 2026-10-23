'use client'

import { useEffect, useRef } from 'react'
import { REDACTION_MASK, type RedactionRange } from '@/lib/support-tickets/redaction'
import { isMaskedWord, pieces, rangeFromPoints, toggleRange, type SelectionPoint } from '@/lib/support-tickets/redaction-select'

/**
 * Lets a person mark parts of a plain text. Two ways, both always available:
 * tap a word to mark / unmark it (phones), or select with the mouse and let the
 * parent add the selection (`onSelect` reports the current selection as a range,
 * null when there is none). Marked parts are highlighted; characters that are
 * already hidden (█) cannot be marked.
 *
 *   <TextMarker text={body} value={ranges} onChange={setRanges} onSelect={setSelection} label="Message text" />
 *
 * The text is rendered as consecutive pieces carrying `data-start` (their offset
 * in `text`), which is how a mouse selection is mapped back to offsets
 * (`rangeFromPoints`). Ranges are [start, end) in UTF-16 units of `text`.
 */
export function TextMarker({
  text,
  value,
  onChange,
  onSelect,
  label,
}: {
  text: string
  value: RedactionRange[]
  onChange: (next: RedactionRange[]) => void
  onSelect?: (range: RedactionRange | null) => void
  /** Accessible name of the text. */
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    const point = (node: Node | null, offset: number): SelectionPoint | null => {
      const el = node instanceof Element ? node : node?.parentElement
      const piece = el?.closest<HTMLElement>('[data-start]')
      if (!piece || !ref.current?.contains(piece)) return null
      // An element boundary (not inside the text node) means before / after the whole piece.
      const base = Number(piece.dataset.start)
      return { pieceStart: base, offset: node instanceof Text ? offset : offset > 0 ? (piece.textContent ?? '').length : 0 }
    }
    const read = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !ref.current) return onSelectRef.current?.(null)
      const a = point(sel.anchorNode, sel.anchorOffset)
      const f = point(sel.focusNode, sel.focusOffset)
      onSelectRef.current?.(a && f ? rangeFromPoints(a, f, text.length) : null)
    }
    document.addEventListener('selectionchange', read)
    return () => document.removeEventListener('selectionchange', read)
  }, [text])

  const isMarked = (start: number, end: number) => value.some((r) => r.start < end && r.end > start)

  return (
    <div ref={ref} role="group" aria-label={label} className="text-[0.9375rem] leading-7 break-words whitespace-pre-wrap">
      {pieces(text).map((p) => {
        const range = { start: p.start, end: p.start + p.text.length }
        if (!p.word) {
          return (
            <span key={p.start} data-start={p.start}>
              {p.text}
            </span>
          )
        }
        if (isMaskedWord(text, range) || p.text.includes(REDACTION_MASK)) {
          return (
            <span key={p.start} data-start={p.start} className="text-muted-foreground">
              {p.text}
            </span>
          )
        }
        const marked = isMarked(range.start, range.end)
        const toggle = () => onChange(toggleRange(value, range, text.length))
        return (
          <span
            key={p.start}
            data-start={p.start}
            role="button"
            tabIndex={0}
            aria-pressed={marked}
            onClick={() => {
              // A drag-selection also ends in a click: only a plain tap toggles the word.
              if (!window.getSelection()?.isCollapsed) return
              toggle()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggle()
              }
            }}
            className={`cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${marked ? 'bg-destructive/20 text-foreground underline decoration-destructive decoration-2 underline-offset-2' : 'hover:bg-hover'}`}
          >
            {p.text}
          </span>
        )
      })}
    </div>
  )
}
