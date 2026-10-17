'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FilterSearch } from '@/components/app/ui/FilterBar'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Pill } from '@/components/app/ui/list/cells'
import type { LabGroup, LabStatus } from '@/lab/registry'

export type LabIndexItem = { id: string; name: string; group: LabGroup; status: LabStatus; summary: string; exports: string[]; used: number }

const GLYPH = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M9 12h6" />
  </svg>
)

/** The Lab index: one search over name, exports and summary; entries grouped by what they are for. */
export function LabIndex({ items, groups }: { items: LabIndexItem[]; groups: readonly LabGroup[] }) {
  const t = useTranslations('admin.lab')
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter((i) => [i.name, i.summary, ...i.exports].some((s) => s.toLowerCase().includes(needle)))
  }, [items, q])

  return (
    <div className="space-y-6">
      <FilterSearch label={t('search')} placeholder={t('searchPlaceholder')} value={q} onChange={setQ} sizing="w-full md:w-96" />
      {shown.length === 0 ? <EmptyState title={t('noResults')} /> : null}
      {groups.map((g) => {
        const entries = shown.filter((e) => e.group === g).sort((a, b) => a.name.localeCompare(b.name))
        if (entries.length === 0) return null
        return (
          <section key={g} aria-labelledby={`lab-${g}`} className="space-y-3">
            <SectionHeading id={`lab-${g}`} title={`${t(`groups.${g}`)} · ${entries.length}`} />
            <div className="grid gap-3 md:grid-cols-2">
              {entries.map((e) => (
                <LinkCard
                  key={e.id}
                  href={`/lab/${e.id}`}
                  icon={GLYPH}
                  title={e.name}
                  badge={e.status === 'canonical' ? undefined : <Pill tone="outline">{t(`status.${e.status}`)}</Pill>}
                  subline={`${t('usedInCount', { count: e.used })} · ${e.summary}`}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
