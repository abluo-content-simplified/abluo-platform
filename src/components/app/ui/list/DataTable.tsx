'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useRouter } from '@/i18n/navigation'
import { Checkbox, isShiftChange } from '@/components/app/ui/Checkbox'
import { CellIconSlot } from './cells'

/**
 * Generic desktop list table (md and up) for every Abluo App list page.
 *
 *   <DataTable
 *     rows={posts} rowKey={(p) => p._id}
 *     columns={[{ key: 'title', header: 'Title', sortable: true, width: 'min-w-56', render: (p) => <CellText … /> }, …]}
 *     selection={{ selected, onToggle, allState, onToggleAll, rowLabel: (p) => `Select ${p.title}`, allLabel: 'Select all' }}
 *     sort={{ column: 'title', dir: 'asc', onSort: (key) => … }}
 *     rowHref={(p) => p.href} onRowClick={(p, newTab) => open(p, newTab)}
 *   />
 *
 * Alignment: every body cell is `align-top` with the same `pt-4`; render
 * cells with the `cells.tsx` primitives, whose first line is a 1.5rem line
 * box, so everything in a row shares one first-line centre. The header text
 * is semibold `text-foreground`; sortable headers show a chevron (muted until
 * active, flipped for ascending). Rows fade their hover background in and
 * out (200ms). The table sits in a horizontal scroll container with a
 * minimum width, so narrow windows scroll sideways instead of hiding columns;
 * popovers in cells portal out, so the container never clips them.
 *
 * Frozen leading columns (`stickyLeadingColumns={n}`): when the table scrolls
 * sideways, the selection checkbox and the first n columns (typically the
 * image and the title) stay in place. Their cells are opaque (the page
 * background, with the row's hover / selected tint layered on top) and the
 * last frozen column shows a soft edge only while the table is scrolled.
 * Offsets are measured from the header cells, so columns keep their own widths.
 */

export type DataTableColumn<T> = {
  key: string
  header: ReactNode
  /** Width classes for the column, e.g. 'w-36' or 'min-w-56'. */
  width?: string
  sortable?: boolean
  /** Extra classes on the body cells (e.g. 'whitespace-nowrap'). */
  className?: string
  render: (row: T) => ReactNode
}

export type DataTableSelection<T> = {
  selected: Set<string>
  onToggle: (id: string, checked: boolean, shift: boolean) => void
  allState: 'none' | 'some' | 'all'
  onToggleAll: (checked: boolean) => void
  rowLabel: (row: T) => string
  allLabel: string
}

export type DataTableSort = { column: string | null; dir: 'asc' | 'desc'; onSort: (key: string) => void }

const CELL = 'px-2 pt-4 pb-4 align-top'
/** A frozen cell: opaque page background; the edge (soft shadow + hairline) shows only while scrolled. */
const STICKY = 'sticky z-[1] bg-background'
const STICKY_EDGE =
  "after:pointer-events-none after:absolute after:inset-y-0 after:-right-2 after:w-2 after:border-l after:border-border after:bg-linear-to-r after:from-foreground/[0.06] after:to-transparent after:opacity-0 after:transition-opacity after:duration-200 after:content-[''] group-data-[scrolled=true]/table:after:opacity-100"
/** The row tints are translucent; on an opaque frozen cell they are layered over the background as an image. */
const STICKY_HOVER = 'group-hover/row:bg-[image:linear-gradient(var(--color-hover),var(--color-hover))]'
const STICKY_SELECTED = 'bg-[image:linear-gradient(var(--color-selected-tint),var(--color-selected-tint))]'

/** Left offsets (px) of the first `count` cells from their measured widths: 0, w0, w0+w1, … */
export function stickyOffsets(widths: number[], count: number): number[] {
  const out: number[] = []
  let left = 0
  for (let i = 0; i < Math.min(count, widths.length); i++) {
    out.push(left)
    left += widths[i]
  }
  return out
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const HEAD = 'px-2 py-1 align-middle text-sm font-semibold whitespace-nowrap text-foreground'

const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selection,
  sort,
  rowHref,
  onRowClick,
  minWidth = 'min-w-[60rem]',
  label,
  rowProps,
  stickyLeadingColumns = 0,
}: {
  rows: T[]
  columns: DataTableColumn<T>[]
  rowKey: (row: T) => string
  selection?: DataTableSelection<T>
  sort?: DataTableSort
  /** The row's link; a row without one is not clickable. */
  rowHref?: (row: T) => string | null | undefined
  /** Clicking the row (outside its own links and controls). Defaults to navigating to rowHref. */
  onRowClick?: (row: T, newTab: boolean) => void
  minWidth?: string
  label?: string
  /** Extra attributes for a row, e.g. `{ 'data-drag-key': id, className: dropEdgeClass(edge) }` for drag-to-reorder. */
  rowProps?: (row: T) => { 'data-drag-key'?: string; className?: string }
  /** Freeze the first n columns (plus the selection checkbox) while the table scrolls sideways. */
  stickyLeadingColumns?: number
}) {
  const router = useRouter()

  // Frozen leading columns: the selection cell counts as one more.
  const stickyCount = stickyLeadingColumns > 0 ? Math.min(stickyLeadingColumns, columns.length) + (selection ? 1 : 0) : 0
  const scrollRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLTableRowElement>(null)
  const [offsets, setOffsets] = useState<number[] | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const measure = useCallback(() => {
    const cells = headRef.current ? Array.from(headRef.current.children) : []
    const next = stickyOffsets(cells.map((c) => c.getBoundingClientRect().width), stickyCount)
    setOffsets((prev) => (prev && prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next))
  }, [stickyCount])
  useIsoLayoutEffect(() => {
    if (!stickyCount) return
    measure()
    const table = headRef.current?.closest('table')
    if (!table || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(table)
    return () => ro.disconnect()
  }, [stickyCount, measure])
  const onScroll = stickyCount ? () => setScrolled((scrollRef.current?.scrollLeft ?? 0) > 0) : undefined
  /** Classes + style for the cell at position `index` (selection cell included). */
  const frozen = (index: number, tint: string): { className: string; style?: CSSProperties } => {
    if (!stickyCount || index >= stickyCount || !offsets) return { className: '' }
    return { className: `${STICKY} ${tint} ${index === stickyCount - 1 ? STICKY_EDGE : ''}`, style: { left: offsets[index] } }
  }
  const lead = selection ? 1 : 0

  const clickable = (row: T) => (rowHref ? Boolean(rowHref(row)) : Boolean(onRowClick))
  const rowClick = (row: T) => (e: MouseEvent<HTMLTableRowElement>) => {
    if (!clickable(row)) return
    // Clicks on the controls inside the row (and on links) are theirs.
    if ((e.target as HTMLElement).closest('a,button,input,label,select,[role="dialog"]')) return
    const newTab = e.metaKey || e.ctrlKey
    if (onRowClick) return onRowClick(row, newTab)
    const href = rowHref?.(row)
    if (href && !newTab) router.push(href)
  }

  const header = (col: DataTableColumn<T>, i: number) => {
    const fz = frozen(i + lead, '')
    if (!col.sortable || !sort) {
      return (
        <th key={col.key} scope="col" className={`${HEAD} ${col.width ?? ''} ${fz.className}`} style={fz.style}>
          <span className="flex min-h-11 items-center">{col.header}</span>
        </th>
      )
    }
    const active = sort.column === col.key
    return (
      <th
        key={col.key}
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${HEAD} ${col.width ?? ''} ${fz.className}`}
        style={fz.style}
      >
        <button
          type="button"
          onClick={() => sort.onSort(col.key)}
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-left font-semibold text-foreground transition-colors duration-200 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {col.header}
          <span
            aria-hidden="true"
            className={`transition-[transform,opacity] duration-200 ${active ? 'opacity-100' : 'opacity-40'} ${active && sort.dir === 'asc' ? 'rotate-180' : ''}`}
          >
            {CHEVRON}
          </span>
        </button>
      </th>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} data-scrolled={stickyCount ? scrolled : undefined} className="group/table overflow-x-auto">
      <table aria-label={label} className={`w-full ${minWidth} table-auto border-collapse text-sm`}>
        <thead>
          <tr ref={headRef} className="border-b border-border text-left">
            {selection ? (
              <th scope="col" className={`${HEAD} w-10 ${frozen(0, '').className}`} style={frozen(0, '').style}>
                <CellIconSlot>
                  <Checkbox
                    checked={selection.allState === 'all'}
                    indeterminate={selection.allState === 'some'}
                    aria-label={selection.allLabel}
                    onChange={(checked) => selection.onToggleAll(checked)}
                  />
                </CellIconSlot>
              </th>
            ) : null}
            {columns.map(header)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = rowKey(row)
            const isSel = selection?.selected.has(id) ?? false
            const extra = rowProps?.(row)
            const tint = isSel ? STICKY_SELECTED : STICKY_HOVER
            return (
              <tr
                key={id}
                data-drag-key={extra?.['data-drag-key']}
                onClick={rowClick(row)}
                aria-selected={selection ? isSel : undefined}
                className={`group/row border-b border-border transition-colors duration-200 ease-out ${clickable(row) ? 'cursor-pointer' : ''} ${
                  isSel ? 'bg-selected-tint' : 'hover:bg-hover'
                } ${extra?.className ?? ''}`}
              >
                {selection ? (
                  <td className={`${CELL} ${frozen(0, tint).className}`} style={frozen(0, tint).style} onClick={(e) => e.stopPropagation()}>
                    <CellIconSlot>
                      <Checkbox
                        checked={isSel}
                        aria-label={selection.rowLabel(row)}
                        onChange={(checked, e) => selection.onToggle(id, checked, isShiftChange(e))}
                      />
                    </CellIconSlot>
                  </td>
                ) : null}
                {columns.map((col, i) => {
                  const fz = frozen(i + lead, tint)
                  return (
                    <td key={col.key} className={`${CELL} ${col.className ?? ''} ${fz.className}`} style={fz.style}>
                      {col.render(row)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
