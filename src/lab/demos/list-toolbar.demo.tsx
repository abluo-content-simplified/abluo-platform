'use client'

import { useMemo, useState } from 'react'
import { ListToolbar, type ListDateValue } from '@/components/app/ui/ListToolbar'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { DemoBlock, DemoStack } from '../demo-kit'

type Post = { id: string; title: string; status: 'published' | 'draft'; lang: 'en' | 'it'; updated: string }

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString()
const POSTS: Post[] = [
  { id: '1', title: 'Spring menu announced', status: 'published', lang: 'en', updated: day(2) },
  { id: '2', title: 'Our new tasting room', status: 'draft', lang: 'en', updated: day(5) },
  { id: '3', title: 'Menu di primavera', status: 'published', lang: 'it', updated: day(12) },
  { id: '4', title: 'Opening hours for summer', status: 'published', lang: 'en', updated: day(40) },
  { id: '5', title: 'Meet the team', status: 'draft', lang: 'it', updated: day(90) },
  { id: '6', title: 'A year in review', status: 'published', lang: 'en', updated: day(200) },
]
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
const DEFAULT_DATE: ListDateValue = { field: 'updated', preset: null, from: null, to: null }

function inPreset(iso: string, preset: string): boolean {
  const age = (Date.now() - new Date(iso).getTime()) / 86_400_000
  if (preset === 'last7') return age <= 7
  if (preset === 'last30') return age <= 30
  return new Date(iso).getFullYear() === new Date().getFullYear()
}

export default function ListToolbarDemo() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [lang, setLang] = useState('all')
  const [date, setDate] = useState<ListDateValue>(DEFAULT_DATE)
  const [selectAll, setSelectAll] = useState(false)

  const visible = useMemo(
    () =>
      POSTS.filter((p) => {
        if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false
        if (status !== 'all' && p.status !== status) return false
        if (lang !== 'all' && p.lang !== lang) return false
        if (date.preset && !inPreset(p.updated, date.preset)) return false
        const d = p.updated.slice(0, 10)
        if (date.from && d < date.from) return false
        if (date.to && d > date.to) return false
        return true
      }),
    [q, status, lang, date]
  )

  const chips = [
    ...(status !== 'all' ? [{ id: 'status', label: STATUS.find((o) => o.value === status)?.label ?? status }] : []),
    ...(lang !== 'all' ? [{ id: 'lang', label: LANG.find((o) => o.value === lang)?.label ?? lang }] : []),
    ...(date.preset || date.from ? [{ id: 'date', label: date.preset ? `Last: ${date.preset}` : `${date.from} to ${date.to ?? '…'}` }] : []),
  ]
  const isDefault = !q && chips.length === 0
  const reset = () => {
    setQ('')
    setStatus('all')
    setLang('all')
    setDate(DEFAULT_DATE)
  }
  const removeChip = (id: string) => {
    if (id === 'status') setStatus('all')
    if (id === 'lang') setLang('all')
    if (id === 'date') setDate((d) => ({ ...d, preset: null, from: null, to: null }))
  }

  return (
    <DemoStack>
      <DemoBlock title="Posts toolbar" note="search, filters (one with placement 'desktop'), date sentence, summary, summaryExtra, dateLineEnd, clear and sheet. Resize below md for the phone sheet.">
        <div className="w-full">
          <ListToolbar
            label="Post filters"
            search={{ value: q, onChange: setQ, placeholder: 'Search posts…' }}
            filters={[
              { key: 'status', label: 'Status', value: status, options: STATUS, onChange: setStatus },
              { key: 'lang', label: 'Language', value: lang, options: LANG, onChange: setLang },
            ]}
            date={{
              noun: 'Posts',
              label: 'Date',
              fieldLabel: 'Which date',
              fields: [
                { value: 'updated', label: 'updated' },
                { value: 'published', label: 'published' },
              ],
              value: date,
              onChange: setDate,
            }}
            summary={`${visible.length} of ${POSTS.length} posts`}
            summaryExtra={
              <label className="inline-flex items-center text-sm text-foreground">
                <Checkbox checked={selectAll} onChange={setSelectAll} aria-label="Select all" className="-my-3 -ml-3" />
                Select all
              </label>
            }
            dateLineEnd={<span className="text-sm text-muted-foreground">Right-aligned controls</span>}
            clear={{ label: 'Clear filters', onClear: reset, visible: !isDefault }}
            sheet={{ activeCount: chips.length, resultCount: visible.length, chips, onRemoveChip: removeChip }}
          />
        </div>
        <ul className="w-full space-y-1 text-sm text-foreground">
          {visible.map((p) => (
            <li key={p.id} className="rounded-lg border border-border px-3 py-2">
              {p.title} <span className="text-muted-foreground">· {p.status} · {p.lang}</span>
            </li>
          ))}
          {visible.length === 0 ? <li className="text-muted-foreground">No posts match.</li> : null}
        </ul>
      </DemoBlock>
    </DemoStack>
  )
}
