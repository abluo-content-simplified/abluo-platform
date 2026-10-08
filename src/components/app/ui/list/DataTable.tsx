'use client'

import type { MouseEvent, ReactNode } from 'react'
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
}) {
  const router = useRouter()

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

  const header = (col: DataTableColumn<T>) => {
    if (!col.sortable || !sort) {
      return (
        <th key={col.key} scope="col" className={`${HEAD} ${col.width ?? ''}`}>
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
        className={`${HEAD} ${col.width ?? ''}`}
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
    <div className="overflow-x-auto">
      <table aria-label={label} className={`w-full ${minWidth} table-auto border-collapse text-sm`}>
        <thead>
          <tr className="border-b border-border text-left">
            {selection ? (
              <th scope="col" className={`${HEAD} w-10`}>
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
            return (
              <tr
                key={id}
                onClick={rowClick(row)}
                aria-selected={selection ? isSel : undefined}
                className={`border-b border-border transition-colors duration-200 ease-out ${clickable(row) ? 'cursor-pointer' : ''} ${
                  isSel ? 'bg-selected-tint' : 'hover:bg-hover'
                }`}
              >
                {selection ? (
                  <td className={CELL} onClick={(e) => e.stopPropagation()}>
                    <CellIconSlot>
                      <Checkbox
                        checked={isSel}
                        aria-label={selection.rowLabel(row)}
                        onChange={(checked, e) => selection.onToggle(id, checked, isShiftChange(e))}
                      />
                    </CellIconSlot>
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td key={col.key} className={`${CELL} ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
