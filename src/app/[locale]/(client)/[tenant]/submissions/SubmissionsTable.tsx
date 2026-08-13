'use client'

/**
 * Submissions dashboard table — ADR-018 slice 6 (full view).
 *
 * Client-side view over the leads the server already fetched (RLS-scoped): it
 * filters, summarises, expands to a full detail (every submitted field +
 * attribution), exports the filtered set to CSV, and moves a lead through its
 * status workflow via the `setSubmissionStatusAction` Server Action (optimistic,
 * with rollback on failure). Volume is modest (server caps the read), so all of
 * this runs in-browser without extra round-trips except the status write.
 *
 * Copy comes from the `clientDashboard` next-intl namespace; field *labels* are
 * humanised from the stored internalKey (a later pass can resolve them from the
 * pinned definition snapshot for fully localized labels).
 */

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import type { DashboardSubmission, SubmissionStatus } from '@/lib/api/client-dashboard'
import { setSubmissionStatusAction } from './actions'

const STATUSES: readonly SubmissionStatus[] = ['new', 'processed', 'archived']

/** "org_type" / "orgType" → "Org type"; leaves human free-text keys sensible. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Prettifies short codes ("book_appointment" → "Book appointment"); leaves free text alone. */
function humanizeValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (Array.isArray(v)) return v.map((x) => humanizeValue(x)).join(', ')
  const s = String(v)
  if (/\s/.test(s) || s.length > 40) return s // free text — leave as-is
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Raw scalar for CSV/grouping (arrays joined, objects skipped). */
function rawValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ')
  if (typeof v === 'object') return ''
  return String(v)
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
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
  const [errorId, setErrorId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

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

  function changeStatus(id: string, next: SubmissionStatus) {
    const prev = rows.find((r) => r.id === id)?.status
    setErrorId(null)
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: next } : r)))
    startTransition(async () => {
      const res = await setSubmissionStatusAction({ projectSlug, submissionId: id, status: next, locale })
      if (!res.ok && prev) {
        setErrorId(id)
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: prev } : r)))
      }
    })
  }

  function exportCsv() {
    const keys = Array.from(new Set(filtered.flatMap((r) => Object.keys(r.data))))
    const srcKeys = Array.from(new Set(filtered.flatMap((r) => (r.source ? Object.keys(r.source) : []))))
    const header = ['id', 'form', 'status', 'received', ...keys, ...srcKeys.map((k) => `source.${k}`)]
    const lines = [header.map(csvEscape).join(',')]
    for (const r of filtered) {
      const cells = [
        r.id,
        r.formId,
        r.status,
        r.createdAt,
        ...keys.map((k) => rawValue(r.data[k])),
        ...srcKeys.map((k) => rawValue(r.source?.[k])),
      ]
      lines.push(cells.map(csvEscape).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${projectSlug}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls =
    'rounded-md border border-border bg-transparent px-2 py-1.5 text-sm text-foreground'

  return (
    <div className="space-y-5">
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <select className={selectCls} value={form} onChange={(e) => setForm(e.target.value)} aria-label={t('submissions.columns.form')}>
          <option value="all">{t('submissions.filters.allForms')}</option>
          {formIds.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('submissions.columns.status')}>
          <option value="all">{t('submissions.filters.allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`submissions.status.${s}`)}</option>
          ))}
        </select>
        <input
          className={selectCls + ' min-w-[12rem]'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('submissions.filters.search')}
        />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t('submissions.filters.from')}
          <input type="date" className={selectCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t('submissions.filters.to')}
          <input type="date" className={selectCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select className={selectCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label={t('submissions.filters.groupBy')}>
          <option value="none">{t('submissions.filters.groupBy')}: {t('submissions.filters.groupNone')}</option>
          <option value="form">{t('submissions.filters.groupBy')}: {t('submissions.filters.groupForm')}</option>
          <option value="status">{t('submissions.filters.groupBy')}: {t('submissions.filters.groupStatus')}</option>
          {dataKeys.map((k) => (
            <option key={k} value={k}>{t('submissions.filters.groupBy')}: {humanizeKey(k)}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{t('submissions.count', { count: filtered.length })}</span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {t('submissions.exportCsv')}
          </button>
        </div>
      </div>

      {/* ── Breakdown summary ───────────────────────────────────────────── */}
      {groups && (
        <div className="flex flex-wrap gap-2">
          {groups.map(([key, n]) => (
            <span key={key} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              {groupBy === 'status' ? t(`submissions.status.${key}`) : humanizeValue(key)}: <span className="font-semibold text-foreground">{n}</span>
            </span>
          ))}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('submissions.noResults')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
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
            {filtered.map((s) => {
              const isOpen = expanded === s.id
              const subject = s.data.subject
              return (
                <Fragment key={s.id}>
                  <tr className="border-b border-border/60 align-top">
                    <td className="py-2 font-medium">{s.name ?? t('submissions.anonymous')}</td>
                    <td className="py-2 text-muted-foreground">{s.email ?? '—'}</td>
                    <td className="py-2 text-muted-foreground">{s.formId}</td>
                    <td className="py-2 text-muted-foreground">{subject ? humanizeValue(subject) : '—'}</td>
                    <td className="py-2 text-muted-foreground">{formatReceived(s.createdAt, locale)}</td>
                    <td className="py-2">
                      <select
                        className={selectCls + ' py-1'}
                        value={s.status}
                        onChange={(e) => changeStatus(s.id, e.target.value as SubmissionStatus)}
                      >
                        {STATUSES.map((st) => (
                          <option key={st} value={st}>{t(`submissions.status.${st}`)}</option>
                        ))}
                      </select>
                      {errorId === s.id && (
                        <span className="ml-2 text-xs text-destructive">{t('submissions.updateError')}</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : s.id)}
                        className="text-xs font-medium underline underline-offset-2 text-muted-foreground hover:text-foreground"
                      >
                        {isOpen ? t('submissions.detail.hide') : t('submissions.detail.show')}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-muted/30">
                      <td colSpan={7} className="py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('submissions.detail.show')}</p>
                            <dl className="space-y-1">
                              {Object.entries(s.data).map(([k, v]) => (
                                <div key={k} className="flex gap-2">
                                  <dt className="w-40 shrink-0 text-muted-foreground">{humanizeKey(k)}</dt>
                                  <dd className="flex-1 break-words">{humanizeValue(v)}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('submissions.detail.attribution')}</p>
                            {s.source && Object.keys(s.source).length > 0 ? (
                              <dl className="space-y-1">
                                {Object.entries(s.source).map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <dt className="w-40 shrink-0 text-muted-foreground">{humanizeKey(k)}</dt>
                                    <dd className="flex-1 break-words">{rawValue(v) || '—'}</dd>
                                  </div>
                                ))}
                              </dl>
                            ) : (
                              <p className="text-muted-foreground">{t('submissions.detail.none')}</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Locale-aware date+time; falls back to the raw ISO string on error. */
function formatReceived(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}
