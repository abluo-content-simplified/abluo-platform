// @vitest-environment jsdom
/**
 * DataTable frozen leading columns (stickyLeadingColumns): offsets measured
 * from the header, the selection cell counted, opaque frozen cells with the
 * row tint layered on top, and the edge shown only while scrolled.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTable, stickyOffsets } from '../list/DataTable'

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Row = { id: string; title: string }
const ROWS: Row[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
]
const COLUMNS = [
  { key: 'image', header: 'Image', render: () => <span>img</span> },
  { key: 'title', header: 'Title', render: (r: Row) => <span>{r.title}</span> },
  { key: 'status', header: 'Status', render: () => <span>ok</span> },
]

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

function render(props: { sticky?: number; selected?: string[] }) {
  // jsdom has no layout: every cell reports 40px.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 40 } as DOMRect)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      <DataTable
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        stickyLeadingColumns={props.sticky}
        selection={{
          selected: new Set(props.selected ?? []),
          onToggle: () => undefined,
          allState: 'none',
          onToggleAll: () => undefined,
          rowLabel: (r) => `Select ${r.title}`,
          allLabel: 'Select all',
        }}
      />,
    ),
  )
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  }
  return host
}

describe('stickyOffsets', () => {
  it('accumulates the widths of the cells before each frozen cell', () => {
    expect(stickyOffsets([40, 112, 224, 128], 3)).toEqual([0, 40, 152])
    expect(stickyOffsets([40], 3)).toEqual([0])
    expect(stickyOffsets([40, 112], 0)).toEqual([])
  })
})

describe('DataTable stickyLeadingColumns', () => {
  it('off by default: no cell is sticky and the scroller carries no scrolled state', () => {
    const host = render({})
    expect(host.querySelectorAll('.sticky')).toHaveLength(0)
    expect(host.querySelector('[data-scrolled]')).toBeNull()
  })

  it('freezes the checkbox plus the first n columns, header included, at measured offsets', () => {
    const host = render({ sticky: 2 })
    const head = Array.from(host.querySelectorAll('thead th'))
    expect(head.slice(0, 3).every((c) => c.classList.contains('sticky'))).toBe(true)
    expect(head[3].classList.contains('sticky')).toBe(false)
    expect(head.slice(0, 3).map((c) => (c as HTMLElement).style.left)).toEqual(['0px', '40px', '80px'])
    const firstRow = Array.from(host.querySelectorAll('tbody tr')[0].children)
    expect(firstRow.slice(0, 3).every((c) => c.classList.contains('bg-background'))).toBe(true)
    expect(firstRow[3].classList.contains('sticky')).toBe(false)
    // Only the last frozen cell draws the edge.
    expect(firstRow[2].className).toContain('after:border-l')
    expect(firstRow[1].className).not.toContain('after:border-l')
  })

  it('layers the hover tint on unselected rows and the selected tint on selected rows', () => {
    const host = render({ sticky: 1, selected: ['b'] })
    const [a, b] = Array.from(host.querySelectorAll('tbody tr')).map((r) => r.children[1].className)
    expect(a).toContain('group-hover/row:bg-[image:')
    expect(b).toContain('var(--color-selected-tint)')
    expect(b).not.toContain('group-hover/row:')
  })

  it('marks the scroller as scrolled only once it scrolls sideways', () => {
    const host = render({ sticky: 1 })
    const scroller = host.querySelector('[data-scrolled]') as HTMLDivElement
    expect(scroller.dataset.scrolled).toBe('false')
    act(() => {
      scroller.scrollLeft = 24
      scroller.dispatchEvent(new Event('scroll'))
    })
    expect(scroller.dataset.scrolled).toBe('true')
  })
})
