'use client'

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type DragOver = { key: string; after: boolean }

/**
 * Pointer-event drag to reorder (never HTML5 drag: `dragstart` does not fire
 * from a finger). Rows carry `data-drag-key="<key>"`; the grip spreads
 * `gripProps(key)`. While dragging, `over` says which row the pointer is on
 * and whether the drop lands before or after it; on release `onDrop(key,
 * over)` is called (not when released on itself or outside every row).
 * Escape cancels. Keyboard reorder is the caller's (up/down buttons).
 */
export function usePointerDrag(onDrop: (key: string, over: DragOver) => void) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<DragOver | null>(null)
  const overRef = useRef<DragOver | null>(null)
  const keyRef = useRef<string | null>(null)

  const end = useCallback(() => {
    keyRef.current = null
    overRef.current = null
    setDragging(null)
    setOver(null)
  }, [])

  const locate = (x: number, y: number): DragOver | null => {
    const el = typeof document !== 'undefined' ? (document.elementFromPoint(x, y) as HTMLElement | null) : null
    const row = el?.closest<HTMLElement>('[data-drag-key]')
    const key = row?.dataset.dragKey
    if (!row || !key) return null
    const r = row.getBoundingClientRect()
    return { key, after: y > r.top + r.height / 2 }
  }

  const gripProps = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      keyRef.current = key
      setDragging(key)
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!keyRef.current) return
      const o = locate(e.clientX, e.clientY)
      const next = o && o.key !== keyRef.current ? o : null
      if (next?.key !== overRef.current?.key || next?.after !== overRef.current?.after) {
        overRef.current = next
        setOver(next)
      }
    },
    onPointerUp: () => {
      const key = keyRef.current
      const target = overRef.current
      end()
      if (key && target) onDrop(key, target)
    },
    onPointerCancel: end,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape' && keyRef.current) end()
    },
    style: { touchAction: 'none' as const },
  })

  return { dragging, over, gripProps }
}
