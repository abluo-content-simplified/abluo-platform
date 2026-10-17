'use client'

import { useMemo, useRef, useState } from 'react'
import { DataTable } from '@/components/app/ui/list/DataTable'
import { CellChips, CellDate, CellImage, CellPill, CellText, Pill } from '@/components/app/ui/list/cells'
import { idRange } from '@/components/app/ui/SelectionBar'
import { DemoBlock, DemoStack } from '../demo-kit'

type Post = { id: string; title: string; summary: string; status: 'Published' | 'Draft'; tags: string[]; updated: string }

const POSTS: Post[] = [
  { id: 'p1', title: 'Spring menu announced', summary: 'Seasonal dishes arrive this week.', status: 'Published', tags: ['News', 'Menu'], updated: '2026-10-06T09:00:00Z' },
  { id: 'p2', title: 'Our new tasting room', summary: 'A look inside the renovated space.', status: 'Draft', tags: ['Events'], updated: '2026-10-03T09:00:00Z' },
  { id: 'p3', title: 'Opening hours for summer', summary: 'Longer evenings from June.', status: 'Published', tags: ['News'], updated: '2026-09-21T09:00:00Z' },
  { id: 'p4', title: 'Meet the team', summary: 'The people behind the kitchen.', status: 'Draft', tags: ['About', 'Team', 'Staff'], updated: '2026-09-02T09:00:00Z' },
  { id: 'p5', title: 'A year in review', summary: 'Twelve months, in numbers.', status: 'Published', tags: ['News'], updated: '2026-08-14T09:00:00Z' },
  { id: 'p6', title: 'Wine list update', summary: 'Five new bottles on the list.', status: 'Published', tags: ['Menu'], updated: '2026-07-30T09:00:00Z' },
]

export default function DataTableDemo() {
  const [sort, setSort] = useState<{ column: string | null; dir: 'asc' | 'desc' }>({ column: 'updated', dir: 'desc' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [opened, setOpened] = useState<string | null>(null)
  const last = useRef<string | null>(null)

  const rows = useMemo(() => {
    const out = [...POSTS]
    const { column, dir } = sort
    if (column) {
      out.sort((a, b) => {
        const av = column === 'updated' ? a.updated : column === 'status' ? a.status : a.title
        const bv = column === 'updated' ? b.updated : column === 'status' ? b.status : b.title
        return av < bv ? -1 : av > bv ? 1 : 0
      })
      if (dir === 'desc') out.reverse()
    }
    return out
  }, [sort])
  const order = rows.map((r) => r.id)

  const onToggle = (id: string, checked: boolean, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const ids = shift && last.current ? idRange(order, last.current, id) : [id]
      for (const x of ids) {
        if (checked) next.add(x)
        else next.delete(x)
      }
      return next
    })
    last.current = id
  }
  const allState = selected.size === 0 ? 'none' : selected.size === rows.length ? 'all' : 'some'

  return (
    <DemoStack>
      <DemoBlock title="Sortable, selectable table" note="columns, rowKey, sort, selection (shift-click selects a range), onRowClick. Needs md width or scrolls sideways.">
        <div className="w-full">
          <DataTable
            label="Posts"
            rows={rows}
            rowKey={(p) => p.id}
            sort={{
              column: sort.column,
              dir: sort.dir,
              onSort: (key) => setSort((s) => (s.column === key ? { column: key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { column: key, dir: 'asc' })),
            }}
            selection={{
              selected,
              onToggle,
              allState,
              onToggleAll: (checked) => setSelected(checked ? new Set(order) : new Set()),
              rowLabel: (p) => `Select ${p.title}`,
              allLabel: 'Select all posts',
            }}
            onRowClick={(p) => setOpened(p.title)}
            columns={[
              { key: 'image', header: 'Image', width: 'w-28', render: () => <CellImage src={null} /> },
              { key: 'title', header: 'Title', sortable: true, width: 'min-w-56', render: (p) => <CellText primary={p.title} secondary={p.summary} /> },
              { key: 'status', header: 'Status', sortable: true, width: 'w-32', render: (p) => <CellPill><Pill tone={p.status === 'Published' ? 'success' : 'muted'}>{p.status}</Pill></CellPill> },
              { key: 'tags', header: 'Tags', width: 'min-w-40', render: (p) => <CellChips items={p.tags} max={2} /> },
              { key: 'updated', header: 'Updated', sortable: true, width: 'w-32', render: (p) => <CellDate iso={p.updated} /> },
            ]}
          />
        </div>
        <p className="w-full text-sm text-muted-foreground" aria-live="polite">
          {selected.size} selected · {opened ? `Row clicked: ${opened}` : 'Click a row.'}
        </p>
      </DemoBlock>
    </DemoStack>
  )
}
