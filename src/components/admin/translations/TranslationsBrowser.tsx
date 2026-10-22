'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import type { FilterChip } from '@/components/app/ui/FilterSheet'
import { ListToolbar, type ListToolbarFilter } from '@/components/app/ui/ListToolbar'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { DataTable, type DataTableColumn } from '@/components/app/ui/list/DataTable'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { CellText, Pill, type PillTone } from '@/components/app/ui/list/cells'
import { LOCALE_NATIVE_NAMES, type SupportedLocale } from '@/lib/i18n/locales'
import { TRANSLATION_STATES, needsAttention, type LanguageSummary, type TranslationRow, type TranslationState } from '@/lib/i18n/translation-report'

/**
 * Admin → Translations (Tom, 2026-10-22): every dashboard text in each
 * interface language, with its state. Read-only — text changes go through
 * the code (messages/*.json); scripts/i18n-translate.mjs fills new text at
 * each release. A "records" list screen: ListToolbar + DataTable on
 * computers, ListRow on phones, a SidePanel for one text.
 *
 * ~3,500 rows: the list renders PAGE at a time ("Show more"), and starts on
 * "Needs a look" so the usual view is short.
 */

const PAGE = 100
type StateFilter = 'attention' | 'all' | TranslationState
type Filters = { q: string; locale: string; state: StateFilter; area: string; dir: 'asc' | 'desc' }
const DEFAULT_FILTERS: Filters = { q: '', locale: '', state: 'attention', area: '', dir: 'asc' }

const TONE: Record<TranslationState, PillTone> = { missing: 'highlight', outdated: 'outline', machine: 'muted', ok: 'success' }

const languageName = (code: string) => LOCALE_NATIVE_NAMES[code as SupportedLocale] ?? code.toUpperCase()

export function TranslationsBrowser({ rows, locales, summary }: { rows: TranslationRow[]; locales: string[]; summary: LanguageSummary[] }) {
  const t = useTranslations('admin.translations')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [limit, setLimit] = useState(PAGE)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setLimit(PAGE)
  }
  const reset = () => update({ ...DEFAULT_FILTERS, dir: filters.dir })

  const scope = filters.locale ? [filters.locale] : locales
  const areaLabel = (area: string) => (t.has(`areas.${area}`) ? t(`areas.${area}` as 'areas.admin') : area)
  const areas = useMemo(() => [...new Set(rows.map((r) => r.area))], [rows])

  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (filters.area && r.area !== filters.area) return false
      if (filters.state === 'attention' && !needsAttention(r, filters.locale || undefined)) return false
      if (filters.state !== 'attention' && filters.state !== 'all' && !scope.some((l) => r.cells[l]?.state === filters.state)) return false
      if (!q) return true
      return (
        r.key.toLowerCase().includes(q) ||
        r.en.toLowerCase().includes(q) ||
        scope.some((l) => (r.cells[l]?.text ?? '').toLowerCase().includes(q))
      )
    })
    return filters.dir === 'asc' ? out : [...out].reverse()
    // `scope` is derived from filters.locale + locales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, locales])

  const visible = shown.slice(0, limit)
  const openRow = openKey ? (rows.find((r) => r.key === openKey) ?? null) : null

  // ── Toolbar ────────────────────────────────────────────────────────────────
  const stateLabel = (s: StateFilter) =>
    s === 'attention' ? t('filters.stateAttention') : s === 'all' ? t('filters.stateAll') : t(`state.${s}`)
  const selects: ListToolbarFilter[] = [
    {
      key: 'state',
      label: t('filters.state'),
      value: filters.state,
      options: (['attention', 'all', ...TRANSLATION_STATES] as StateFilter[]).map((s) => ({ value: s, label: stateLabel(s) })),
      onChange: (v) => update({ state: v as StateFilter }),
    },
    {
      key: 'locale',
      label: t('filters.language'),
      value: filters.locale,
      options: [{ value: '', label: t('filters.languageAll') }, ...locales.map((l) => ({ value: l, label: languageName(l) }))],
      onChange: (v) => update({ locale: v }),
    },
    {
      key: 'area',
      label: t('filters.area'),
      value: filters.area,
      options: [{ value: '', label: t('filters.areaAll') }, ...areas.map((a) => ({ value: a, label: areaLabel(a) }))],
      onChange: (v) => update({ area: v }),
    },
  ]
  const chips: FilterChip[] = []
  if (filters.state !== DEFAULT_FILTERS.state) chips.push({ id: 'state', label: stateLabel(filters.state) })
  if (filters.locale) chips.push({ id: 'locale', label: languageName(filters.locale) })
  if (filters.area) chips.push({ id: 'area', label: areaLabel(filters.area) })
  const removeChip = (id: string) => update(id === 'state' ? { state: DEFAULT_FILTERS.state } : ({ [id]: '' } as Partial<Filters>))
  const isDefault = !filters.q && !filters.locale && !filters.area && filters.state === DEFAULT_FILTERS.state

  // ── Table ──────────────────────────────────────────────────────────────────
  const StatePill = ({ state }: { state: TranslationState }) => <Pill tone={TONE[state]}>{t(`state.${state}`)}</Pill>
  const columns: DataTableColumn<TranslationRow>[] = [
    {
      key: 'text',
      header: t('columns.text'),
      sortable: true,
      width: 'min-w-72',
      render: (r) => <CellText primary={r.en} secondary={r.key} secondaryLines={1} />,
    },
    ...scope.map<DataTableColumn<TranslationRow>>((l) => ({
      key: l,
      header: languageName(l),
      width: 'min-w-56',
      render: (r) => (
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <StatePill state={r.cells[l].state} />
          {r.cells[l].text ? <span className="line-clamp-2 text-sm leading-5 text-foreground">{r.cells[l].text}</span> : null}
        </span>
      ),
    })),
  ]

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <PageHeader title={t('title')} />
        <p className="max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <StatGrid label={t('statsLabel')}>
        {summary.map((s) => (
          <StatTile
            key={s.locale}
            label={languageName(s.locale)}
            value={s.total - s.missing}
            sub={t('statSub', { total: s.total, missing: s.missing, outdated: s.outdated, machine: s.machine })}
          />
        ))}
      </StatGrid>

      <ListToolbar
        label={t('filters.label')}
        search={{ value: filters.q, onChange: (q) => update({ q }), label: t('filters.search'), placeholder: t('filters.searchPlaceholder') }}
        filters={selects}
        summary={t('filters.showing', { shown: shown.length, total: rows.length })}
        clear={{ label: t('filters.clear'), onClear: reset, visible: !isDefault }}
        sheet={{ activeCount: chips.length, resultCount: shown.length, chips, onRemoveChip: removeChip }}
        filterWidth="w-[10rem]"
      />

      {shown.length === 0 ? (
        isDefault ? (
          <EmptyState
            title={t('allGood')}
            body={t('allGoodBody')}
            action={<Button onClick={() => update({ state: 'all' })}>{t('filters.stateAll')}</Button>}
          />
        ) : (
          <EmptyState title={t('filters.noMatch')} action={<Button onClick={reset}>{t('filters.clear')}</Button>} />
        )
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              label={t('title')}
              rows={visible}
              rowKey={(r) => r.key}
              columns={columns}
              minWidth="min-w-[52rem]"
              sort={{ column: 'text', dir: filters.dir, onSort: () => update({ dir: filters.dir === 'asc' ? 'desc' : 'asc' }) }}
              onRowClick={(r) => setOpenKey(r.key)}
            />
          </div>
          <ul aria-label={t('title')} className="flex flex-col gap-3 md:hidden">
            {visible.map((r) => (
              <ListRow key={r.key} onOpen={() => setOpenKey(r.key)} label={t('detail.open', { key: r.key })}>
                <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{r.en}</span>
                <span className="line-clamp-1 text-sm leading-5 text-muted-foreground">{r.key}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {scope.map((l) => (
                    <Pill key={l} tone={TONE[r.cells[l].state]}>
                      {`${l.toUpperCase()} · ${t(`state.${r.cells[l].state}`)}`}
                    </Pill>
                  ))}
                </span>
              </ListRow>
            ))}
          </ul>
          {shown.length > limit ? (
            <div className="flex justify-center">
              <Button onClick={() => setLimit((n) => n + PAGE)}>{t('showMore', { count: Math.min(PAGE, shown.length - limit) })}</Button>
            </div>
          ) : null}
        </>
      )}

      <SidePanel open={openRow !== null} title={openRow?.en ?? ''} subtitle={openRow?.key} closeLabel={t('detail.close')} onClose={() => setOpenKey(null)}>
        {openRow ? <TranslationDetail row={openRow} locales={locales} /> : null}
      </SidePanel>
    </div>
  )
}

function TranslationDetail({ row, locales }: { row: TranslationRow; locales: string[] }) {
  const t = useTranslations('admin.translations')
  return (
    <div className="flex flex-col gap-6">
      <dl>
        <FactRow label={t('detail.key')}>
          <span className="font-mono text-sm">{row.key}</span>
        </FactRow>
      </dl>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm leading-5 font-semibold text-foreground">{t('detail.english')}</h3>
        <p className="text-[0.9375rem] leading-6 whitespace-pre-wrap text-foreground" lang="en">
          {row.en}
        </p>
      </section>
      {locales.map((l) => {
        const cell = row.cells[l]
        return (
          <section key={l} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm leading-5 font-semibold text-foreground">{languageName(l)}</h3>
              <Pill tone={TONE[cell.state]}>{t(`state.${cell.state}`)}</Pill>
            </div>
            {cell.text ? (
              <p className="text-[0.9375rem] leading-6 whitespace-pre-wrap text-foreground" lang={l}>
                {cell.text}
              </p>
            ) : (
              <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('detail.empty')}</p>
            )}
            <p className="text-sm leading-5 text-muted-foreground">{t(`stateHint.${cell.state}`)}</p>
          </section>
        )
      })}
    </div>
  )
}
