'use client'

import { useState } from 'react'
import { FilterBar, FilterDate, FilterSearch, FilterSegmented, FilterSelect } from '@/components/app/ui/FilterBar'
import { DemoBlock, DemoStack } from '../demo-kit'

const STATUS = [
  { value: 'all', label: 'All statuses' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
]
const SORT = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

export default function FilterBarDemo() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [sort, setSort] = useState('newest')
  return (
    <DemoStack>
      <DemoBlock title="All controls" note="FilterBar with FilterSearch, FilterSelect, FilterDate and FilterSegmented. All 2.75rem tall; wraps on phones.">
        <div className="w-full">
          <FilterBar label="Demo filters">
            <FilterSearch value={q} onChange={setQ} placeholder="Search posts…" />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS} />
            <FilterDate label="From" value={from} onChange={setFrom} />
            <FilterSegmented label="Sort" value={sort} onChange={setSort} options={SORT} />
          </FilterBar>
        </div>
        <p className="w-full text-sm text-muted-foreground">
          q=“{q}” · status={status} · from={from || '—'} · sort={sort}
        </p>
      </DemoBlock>
    </DemoStack>
  )
}
