'use client'

import { useState } from 'react'
import { FilterSelect } from '@/components/app/ui/FilterBar'
import { AppliedFilterChips, FilterSheet, type FilterChip } from '@/components/app/ui/FilterSheet'
import { DemoBlock, DemoStack } from '../demo-kit'

const STATUS = [
  { value: 'all', label: 'All statuses' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
]
const LANG = [
  { value: 'all', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'it', label: 'Italian' },
]
const POSTS = [
  { status: 'published', lang: 'en' },
  { status: 'published', lang: 'it' },
  { status: 'draft', lang: 'en' },
  { status: 'draft', lang: 'it' },
  { status: 'published', lang: 'en' },
]

export default function FilterSheetDemo() {
  const [status, setStatus] = useState('all')
  const [lang, setLang] = useState('all')
  const reset = () => {
    setStatus('all')
    setLang('all')
  }
  const chips: FilterChip[] = []
  if (status !== 'all') chips.push({ id: 'status', label: STATUS.find((o) => o.value === status)?.label ?? status })
  if (lang !== 'all') chips.push({ id: 'lang', label: LANG.find((o) => o.value === lang)?.label ?? lang })
  const count = POSTS.filter((p) => (status === 'all' || p.status === status) && (lang === 'all' || p.lang === lang)).length
  const remove = (id: string) => (id === 'status' ? setStatus('all') : setLang('all'))
  return (
    <DemoStack>
      <DemoBlock title="Sheet trigger + applied chips" note="activeCount, resultCount, onClearAll, children; AppliedFilterChips with chips, onRemove, onClearAll. Phone pattern, works at any width.">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <FilterSheet activeCount={chips.length} resultCount={count} onClearAll={reset}>
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS} sizing="w-full" />
            <FilterSelect label="Language" value={lang} onChange={setLang} options={LANG} sizing="w-full" />
          </FilterSheet>
          <AppliedFilterChips chips={chips} onRemove={remove} onClearAll={reset} />
          <p className="text-sm text-muted-foreground">{count} of {POSTS.length} posts</p>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
