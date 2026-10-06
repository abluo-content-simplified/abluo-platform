'use client'

/**
 * Submissions dashboard — ADR-018 slice 6.
 *
 * Client-side view over the leads the server already fetched (RLS-scoped):
 * filter row, summary, a table on desktop (checkbox column, shift-click range)
 * and tap-to-open cards on phones (long-press / "Select" for multi-select),
 * a floating action bar for batch status / export / delete, and the detail with
 * "Where it came from". Writes go through Server Actions (optimistic, rolled
 * back on failure); batches are chunked to the server cap of 100.
 *
 * TODO(FilterBar): switch the local Filter* controls to
 * `@/components/client/ui/FilterBar` (FilterSelect / FilterSearch / FilterDate)
 * once it lands. Same spec: 44px, rounded-xl, 0.9375rem.
 */

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import type { DashboardSubmission, SubmissionStatus } from '@/lib/api/client-dashboard'
import {
  deleteSubmissionsAction,
  setSubmissionStatusAction,
  setSubmissionsStatusBatchAction,
} from './actions'
import { formatReceived, humanizeKey, humanizeValue, rawValue, SubmissionDetail } from './SubmissionDetail'

const STATUSES: readonly SubmissionStatus[] = ['new', 'processed', 'archived']
const BATCH = 100
const LONG_PRESS_MS = 500

const control =
  'h-11 rounded-xl border border-border bg-transparent px-3 text-[0.9375rem] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function FilterSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} w-full md:w-auto ${props.className ?? ''}`} />
}
function FilterSearch(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="search" {...props} className={`${control} w-full md:w-60 ${props.className ?? ''}`} />
}
function FilterDate({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`${control} flex items-center gap-2`}>
      <span className="text-muted-foreground">{label}</span>
      <input type="date" {...props} className="h-full min-w-0 flex-1 bg-transparent text-[0.9375rem] focus:outline-none" />
    </label>
  )
}

/** CSV cell: quotes/commas/newlines escaped, spreadsheet formulas neutralised. */
function csvEscape(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function firstLine(s: DashboardSubmission): string {
  const keys = ['message', 'msg', 'notes', 'comment', 'details', 'subject']
  let text = ''
  for (const k of keys) {
    const v = s.data[k]
    if (typeof v === 'string' && v.trim()) {
      text = v
      break
    }
  }
  if (!text) {
    for (const [k, v] of Object.entries(s.data)) {
      if (k === 'name' || k === 'email' || typeof v !== 'string') continue
      if (v.length > text.length) text = v
    }
  }
  return text.trim().split(/\r?\n/)[0] ?? ''
}

function statusPill(status: SubmissionStatus): string {
  if (status === 'new') return 'bg-accent text-accent-foreground'
  if (status === 'processed') return 'bg-muted text-foreground'
  return 'border border-border text-muted-foreground'
}

function Tick({ on, round }: { on: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-6 shrink-0 place-items-center border-2 ${round ? 'rounded-full' : 'rounded-md'} ${
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
      }`}
    >
      {on ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : null}
    </span>
  )
}

interface Props {
  submissions: DashboardSubmission[]
  projectSlug: string
  locale: string
}

export function SubmissionsTable({ submissions, projectSlug, locale }: Props) {
  const t = useTranslations('clientDashboard')
  const [rows, setRows] = useState<DashboardSubmission[]>(submissions)
  const [form, setForm] = useState('all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [groupBy, setGroupBy] = useState('none')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false) // phone only; desktop always shows checkboxes
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [, startTransition] = useTransition()
  const lastIdx = useRef<number | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const formIds = useMemo(() => Array.from(new Set(rows.map((r) => r.formId))).sort(), [rows])
  const dataKeys = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r.data)) s.add(k)
    return Array.from(s).sort()
  }, [rows])

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (form !== 'all' && r.formId !== form) return false
        if (status !== 'all' && r.status !== status) return false
        const day = r.createdAt.slice(0, 10)
        if (from && day < from) return false
        if (to && day > to) return false
        if (q.trim()) {
          const hay = `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase()
          if (!hay.includes(q.trim().toLowerCase())) return false
        }
        return true
      }),
    [rows, form, status, from, to, q],
  )

  const groups = useMemo(() => {
    if (groupBy === 'none') return null
    const counts = new Map<string, number>()
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)
    for (const r of filtered) {
      if (groupBy === 'form') bump(r.formId)
      else if (groupBy === 'status') bump(r.status)
      else {
        const v = r.data[groupBy]
        if (Array.isArray(v)) v.forEach((x) => bump(String(x)))
        else bump(rawValue(v) || '—')
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [filtered, groupBy])

  // Selection only ever covers rows that still exist.
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])
  const count = selectedRows.length
  const barOpen = count > 0 || selectMode

  useEffect(() => {
    if (!moreOpen && !confirmDelete && !sheetId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMoreOpen(false)
      setConfirmDelete(false)
      setSheetId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen, confirmDelete, sheetId])

  function clearSelection() {
    setSelected(new Set())
    setSelectMode(false)
    setMoreOpen(false)
    lastIdx.current = null
  }

  function toggle(id: string, idx: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastIdx.current !== null) {
        const [a, b] = [Math.min(lastIdx.current, idx), Math.max(lastIdx.current, idx)]
        const turnOn = !prev.has(id)
        for (let i = a; i <= b; i++) {
          if (turnOn) next.add(filtered[i].id)
          else next.delete(filtered[i].id)
        }
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastIdx.current = idx
  }

  const allOn = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  function toggleAll() {
    setSelected(allOn ? new Set() : new Set(filtered.map((r) => r.id)))
  }

  function changeStatus(id: string, next: SubmissionStatus) {
    const prev = rows.find((r) => r.id === id)?.status
    setErrorMsg(null)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: next } : r)))
    startTransition(async () => {
      const res = await setSubmissionStatusAction({ projectSlug, submissionId: id, status: next, locale })
      if (!res.ok && prev) {
        setErrorMsg(t('submissions.updateError'))
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: prev } : r)))
      }
    })
  }

  async function runChunks(ids: string[], call: (chunk: string[]) => Promise<{ ok: boolean }>): Promise<string[]> {
    const done: string[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH)
      const res = await call(chunk)
      if (!res.ok) break
      done.push(...chunk)
    }
    return done
  }

  async function batchStatus(next: SubmissionStatus) {
    const ids = selectedRows.map((r) => r.id)
    const before = new Map(selectedRows.map((r) => [r.id, r.status]))
    setBusy(true)
    setErrorMsg(null)
    setMoreOpen(false)
    setRows((rs) => rs.map((r) => (before.has(r.id) ? { ...r, status: next } : r)))
    const done = new Set(
      await runChunks(ids, (submissionIds) =>
        setSubmissionsStatusBatchAction({ projectSlug, submissionIds, status: next, locale }),
      ),
    )
    if (done.size < ids.length) {
      setErrorMsg(t('submissions.batchError'))
      setRows((rs) => rs.map((r) => (before.has(r.id) && !done.has(r.id) ? { ...r, status: before.get(r.id)! } : r)))
    } else clearSelection()
    setBusy(false)
  }

  async function batchDelete() {
    const ids = selectedRows.map((r) => r.id)
    setBusy(true)
    setErrorMsg(null)
    setConfirmDelete(false)
    setMoreOpen(false)
    const done = new Set(
      await runChunks(ids, (submissionIds) => deleteSubmissionsAction({ projectSlug, submissionIds, locale })),
    )
    setRows((rs) => rs.filter((r) => !done.has(r.id)))
    if (done.size < ids.length) {
      setErrorMsg(t('submissions.batchError'))
      setSelected(new Set(ids.filter((i) => !done.has(i))))
    } else clearSelection()
    setBusy(false)
  }

  function exportCsv(list: DashboardSubmission[]) {
    const keys = Array.from(new Set(list.flatMap((r) => Object.keys(r.data))))
    const srcKeys = Array.from(new Set(list.flatMap((r) => (r.source ? Object.keys(r.source) : []))))
    const header = ['id', 'form', 'status', 'received', 'locale', ...keys, ...srcKeys.map((k) => `source.${k}`)]
    const lines = [header.map(csvEscape).join(',')]
    for (const r of list) {
      const cells = [
        r.id,
        r.formId,
        r.status,
        r.createdAt,
        r.locale ?? '',
        ...keys.map((k) => rawValue(r.data[k])),
        ...srcKeys.map((k) => rawValue(r.source?.[k])),
      ]
      lines.push(cells.map(csvEscape).join(','))
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${projectSlug}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Phone card press handling: long-press enters selection, tap opens / toggles.
  function pressStart(id: string, idx: number) {
    longPressed.current = false
    if (selectMode || count > 0) return
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      setSelectMode(true)
      toggle(id, idx, false)
    }, LONG_PRESS_MS)
  }
  function pressEnd() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
  }
  function cardTap(id: string, idx: number) {
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (selectMode || count > 0) toggle(id, idx, false)
    else setSheetId(id)
  }

  const sheetRow = sheetId ? rows.find((r) => r.id === sheetId) ?? null : null
  const anon = t('submissions.anonymous')
  const barBtn =
    'inline-flex h-11 items-center justify-center rounded-xl px-4 text-[0.9375rem] font-medium transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50'

  return (
    <div className={`space-y-5 ${barOpen ? 'pb-40 md:pb-28' : ''}`}>
      {/* ── Filters (every control 44px) ───────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center">
        <FilterSelect value={form} onChange={(e) => setForm(e.target.value)} aria-label={t('submissions.columns.form')}>
          <option value="all">{t('submissions.filters.allForms')}</option>
          {formIds.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </FilterSelect>
        <FilterSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('submissions.columns.status')}>
          <option value="all">{t('submissions.filters.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`submissions.status.${s}`)}</option>
          ))}
        </FilterSelect>
        <FilterSearch
          className="col-span-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('submissions.filters.search')}
          aria-label={t('submissions.filters.search')}
        />
        <FilterDate label={t('submissions.filters.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
        <FilterDate label={t('submissions.filters.to')} value={to} onChange={(e) => setTo(e.target.value)} />
        <FilterSelect
          className="col-span-2"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          aria-label={t('submissions.filters.groupBy')}
        >
          <option value="none">{t('submissions.filters.groupBy')}: {t('submissions.filters.groupNone')}</option>
          <option value="form">{t('submissions.filters.groupBy')}: {t('submissions.filters.groupForm')}</option>
          <option value="status">{t('submissions.filters.groupBy')}: {t('submissions.filters.groupStatus')}</option>
          {dataKeys.map((k) => (
            <option key={k} value={k}>{t('submissions.filters.groupBy')}: {humanizeKey(k)}</option>
          ))}
        </FilterSelect>
      </div>

      <div className="flex min-h-11 items-center gap-3">
        <span className="text-[0.9375rem] text-muted-foreground">{t('submissions.count', { count: filtered.length })}</span>
        <div className="ml-auto flex items-center gap-2">
          {!selectMode && filtered.length > 0 && (
            <button type="button" onClick={() => setSelectMode(true)} className={`${barBtn} border border-border md:hidden`}>
              {t('submissions.select')}
            </button>
          )}
          <button
            type="button"
            onClick={() => exportCsv(filtered)}
            disabled={filtered.length === 0}
            className={`${barBtn} hidden border border-border md:inline-flex`}
          >
            {t('submissions.exportCsv')}
          </button>
        </div>
      </div>

      {groups && (
        <div className="flex flex-wrap gap-2">
          {groups.map(([key, n]) => (
            <span key={key} className="rounded-full border border-border px-3 py-1 text-[0.8125rem] text-muted-foreground">
              {groupBy === 'status' ? t(`submissions.status.${key}`) : humanizeValue(key)}:{' '}
              <span className="font-semibold text-foreground">{n}</span>
            </span>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-[0.9375rem] text-muted-foreground">{t('submissions.noResults')}</p>
      ) : (
        <>
          {/* ── Phone cards ─────────────────────────────────────────────── */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((s, idx) => {
              const on = selected.has(s.id)
              const line = firstLine(s)
              const selecting = selectMode || count > 0
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => cardTap(s.id, idx)}
                    onPointerDown={() => pressStart(s.id, idx)}
                    onPointerUp={pressEnd}
                    onPointerLeave={pressEnd}
                    onPointerCancel={pressEnd}
                    onContextMenu={(e) => e.preventDefault()}
                    aria-pressed={selecting ? on : undefined}
                    className={`flex w-full select-none items-start gap-3 rounded-2xl border p-4 text-left [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                      on ? 'border-primary bg-accent/40' : 'border-border'
                    }`}
                  >
                    {selecting && <Tick on={on} round />}
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-[1rem] font-medium">{s.name ?? anon}</span>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[0.75rem] font-medium ${statusPill(s.status)}`}>
                          {t(`submissions.status.${s.status}`)}
                        </span>
                      </span>
                      <span className="block truncate text-[0.8125rem] text-muted-foreground">
                        {s.formId} · <span suppressHydrationWarning>{formatReceived(s.createdAt, locale)}</span>
                      </span>
                      {line && <span className="line-clamp-1 block text-[0.9375rem] text-muted-foreground">{line}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {/* ── Desktop table ───────────────────────────────────────────── */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[0.9375rem]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="w-10 py-2 pr-2">
                    <button type="button" onClick={toggleAll} aria-label={t('submissions.selectAll')} className="grid size-8 place-items-center">
                      <Tick on={allOn} />
                    </button>
                  </th>
                  <th className="py-2 font-medium">{t('submissions.columns.name')}</th>
                  <th className="py-2 font-medium">{t('submissions.columns.email')}</th>
                  <th className="py-2 font-medium">{t('submissions.columns.form')}</th>
                  <th className="py-2 font-medium">{t('submissions.columns.subject')}</th>
                  <th className="py-2 font-medium">{t('submissions.columns.received')}</th>
                  <th className="py-2 font-medium">{t('submissions.columns.status')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, idx) => {
                  const isOpen = expanded === s.id
                  const subject = s.data.subject
                  return (
                    <Fragment key={s.id}>
                      <tr className={`border-b border-border/60 align-top ${selected.has(s.id) ? 'bg-accent/30' : ''}`}>
                        <td className="py-2 pr-2">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={selected.has(s.id)}
                            aria-label={t('submissions.selectRow', { name: s.name ?? anon })}
                            onClick={(e) => toggle(s.id, idx, e.shiftKey)}
                            className="grid size-8 place-items-center"
                          >
                            <Tick on={selected.has(s.id)} />
                          </button>
                        </td>
                        <td className="py-2 pt-3 font-medium">{s.name ?? anon}</td>
                        <td className="py-2 pt-3 text-muted-foreground">{s.email ?? '—'}</td>
                        <td className="py-2 pt-3 text-muted-foreground">{s.formId}</td>
                        <td className="py-2 pt-3 text-muted-foreground">{subject ? humanizeValue(subject) : '—'}</td>
                        <td className="py-2 pt-3 text-muted-foreground">
                          <span suppressHydrationWarning>{formatReceived(s.createdAt, locale)}</span>
                        </td>
                        <td className="py-2">
                          <select
                            className="h-9 rounded-lg border border-border bg-transparent px-2 text-[0.9375rem]"
                            aria-label={`${t('submissions.columns.status')}: ${s.name ?? anon}`}
                            value={s.status}
                            onChange={(e) => changeStatus(s.id, e.target.value as SubmissionStatus)}
                          >
                            {STATUSES.map((st) => (
                              <option key={st} value={st}>{t(`submissions.status.${st}`)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                            aria-expanded={isOpen}
                            className="inline-flex min-h-9 items-center px-2 text-[0.8125rem] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          >
                            {isOpen ? t('submissions.detail.hide') : t('submissions.detail.show')}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-border/60 bg-muted/30">
                          <td colSpan={8} className="p-4">
                            <SubmissionDetail s={s} locale={locale} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Floating selection bar ─────────────────────────────────────── */}
      {barOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:bottom-6">
          <div
            role="toolbar"
            aria-label={t('submissions.selected', { count })}
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-raise)]"
          >
            <button type="button" onClick={clearSelection} aria-label={t('submissions.exitSelect')} className="grid size-11 place-items-center rounded-xl hover:bg-hover">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <span role="status" className="px-2 text-[0.9375rem] font-medium">{t('submissions.selected', { count })}</span>
            {errorMsg && <span role="alert" className="px-2 text-[0.8125rem] text-destructive">{errorMsg}</span>}
            <button type="button" disabled={busy || count === 0} onClick={() => batchStatus('processed')} className={barBtn}>
              {t('submissions.markHandled')}
            </button>
            <button type="button" disabled={busy || count === 0} onClick={() => batchStatus('new')} className={barBtn}>
              {t('submissions.markNew')}
            </button>
            <button type="button" disabled={count === 0} onClick={() => exportCsv(selectedRows)} className={`${barBtn} hidden md:inline-flex`}>
              {t('submissions.exportSelected')}
            </button>
            <button type="button" disabled={busy || count === 0} onClick={() => setConfirmDelete(true)} className={`${barBtn} hidden text-destructive md:inline-flex`}>
              {t('submissions.delete')}
            </button>
            <button type="button" disabled={count === 0} onClick={() => setMoreOpen(true)} className={`${barBtn} md:hidden`}>
              {t('submissions.more')}
            </button>
          </div>
        </div>
      )}

      {/* ── Phone "More" bottom sheet ──────────────────────────────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-foreground/40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            role="dialog"
            aria-label={t('submissions.more')}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-t-3xl bg-popover p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] text-popover-foreground"
          >
            <button type="button" onClick={() => { exportCsv(selectedRows); setMoreOpen(false) }} className="flex min-h-12 w-full items-center rounded-xl px-4 text-left text-[0.9375rem] hover:bg-hover">
              {t('submissions.exportSelected')}
            </button>
            <button type="button" onClick={() => { setMoreOpen(false); setConfirmDelete(true) }} className="flex min-h-12 w-full items-center rounded-xl px-4 text-left text-[0.9375rem] text-destructive hover:bg-hover">
              {t('submissions.delete')}
            </button>
            <button type="button" onClick={() => setMoreOpen(false)} className="flex min-h-12 w-full items-center rounded-xl px-4 text-left text-[0.9375rem] text-muted-foreground hover:bg-hover">
              {t('submissions.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 md:items-center" onClick={() => setConfirmDelete(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sub-del-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-3xl bg-popover p-6 text-popover-foreground shadow-[var(--shadow-raise)]"
          >
            <h2 id="sub-del-title" className="text-[1.125rem] font-semibold">{t('submissions.deleteTitle', { count })}</h2>
            <p className="text-[0.9375rem] text-muted-foreground">{t('submissions.deleteBody')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className={`${barBtn} border border-border`}>
                {t('submissions.cancel')}
              </button>
              <button type="button" onClick={batchDelete} className={`${barBtn} bg-destructive text-primary-foreground hover:bg-destructive/90`}>
                {t('submissions.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Phone detail sheet ─────────────────────────────────────────── */}
      {sheetRow && (
        <div className="fixed inset-0 z-50 flex items-end bg-foreground/40 md:hidden" onClick={() => setSheetId(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={sheetRow.name ?? anon}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full space-y-5 overflow-y-auto rounded-t-3xl bg-popover p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-popover-foreground"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[1.125rem] font-semibold">{sheetRow.name ?? anon}</h2>
                {sheetRow.email && <p className="truncate text-[0.9375rem] text-muted-foreground">{sheetRow.email}</p>}
              </div>
              <button type="button" onClick={() => setSheetId(null)} aria-label={t('submissions.detail.hide')} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-hover">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <FilterSelect
              value={sheetRow.status}
              onChange={(e) => changeStatus(sheetRow.id, e.target.value as SubmissionStatus)}
              aria-label={t('submissions.columns.status')}
            >
              {STATUSES.map((st) => (
                <option key={st} value={st}>{t(`submissions.status.${st}`)}</option>
              ))}
            </FilterSelect>
            {errorMsg && <p role="alert" className="text-[0.8125rem] text-destructive">{errorMsg}</p>}
            <SubmissionDetail s={sheetRow} locale={locale} />
          </div>
        </div>
      )}
    </div>
  )
}
