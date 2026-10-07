/**
 * Forms (contact requests) list filters, sort, summary and CSV — client-side,
 * on the loaded list, the same shape as posts-filter.ts / people-filter.ts.
 * Pure, so it is unit-tested (__tests__/submissions-filter.test.ts).
 */
import type { DashboardSubmission, SubmissionStatus } from '@/lib/api/client-dashboard'
import { presetRange, todayISO, type RangePreset } from './date-range'

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = ['new', 'processed', 'archived']

export type SubmissionStatusFilter = 'all' | SubmissionStatus
export type SubmissionSortColumn = 'received' | 'name'
export type SubmissionFilters = {
  /** Free text: name, email and every text the visitor sent. */
  q: string
  /** One form id, or '' for every form. */
  form: string
  status: SubmissionStatusFilter
  /** A quick range on the received date, or 'all' (a custom range uses from/to). */
  range: RangePreset | 'all'
  /** Custom range, ISO days (inclusive); '' when unused. */
  from: string
  to: string
  sort: { column: SubmissionSortColumn; dir: 'asc' | 'desc' }
}

export const DEFAULT_SUBMISSION_FILTERS: SubmissionFilters = {
  q: '',
  form: '',
  status: 'all',
  range: 'all',
  from: '',
  to: '',
  sort: { column: 'received', dir: 'desc' },
}

/** The local calendar day (YYYY-MM-DD) of an ISO timestamp, in the viewer's time zone. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : todayISO(d)
}

function textOf(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(textOf).join(' ')
  if (typeof v === 'object') return ''
  return String(v)
}

/** Name, email and every value the visitor sent, lower-cased, for search. */
export function searchText(s: DashboardSubmission): string {
  return [s.name ?? '', s.email ?? '', ...Object.values(s.data).map(textOf)].join(' ').toLowerCase()
}

/** The received-date window the filters select, or null for any date. */
export function dateWindow(f: SubmissionFilters, today: string): { from: string; to: string } | null {
  if (f.from) return { from: f.from, to: f.to || f.from }
  if (f.range !== 'all') return presetRange(f.range, today)
  return null
}

function matches(s: DashboardSubmission, f: SubmissionFilters, q: string, win: { from: string; to: string } | null): boolean {
  if (f.form && s.formId !== f.form) return false
  if (f.status !== 'all' && s.status !== f.status) return false
  if (win) {
    const day = localDay(s.createdAt)
    if (day < win.from || day > win.to) return false
  }
  if (q && !searchText(s).includes(q)) return false
  return true
}

const STATUS_ORDER: Record<SubmissionStatus, number> = { new: 0, processed: 1, archived: 2 }

export function applySubmissionFilters(rows: DashboardSubmission[], f: SubmissionFilters, today = todayISO()): DashboardSubmission[] {
  const q = f.q.trim().toLowerCase()
  const win = dateWindow(f, today)
  const dir = f.sort.dir === 'asc' ? 1 : -1
  const time = (s: DashboardSubmission) => Date.parse(s.createdAt) || 0
  return rows
    .filter((s) => matches(s, f, q, win))
    .sort((a, b) => {
      if (f.sort.column === 'name') {
        const c = (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '', undefined, { sensitivity: 'base' })
        if (c !== 0) return c * dir
      } else {
        const c = time(a) - time(b)
        if (c !== 0) return c * dir
      }
      return time(b) - time(a) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    })
}

/** How many requests each status would show with the other filters as they are. */
export function submissionStatusCounts(rows: DashboardSubmission[], f: SubmissionFilters, today = todayISO()): Record<SubmissionStatusFilter, number> {
  const q = f.q.trim().toLowerCase()
  const win = dateWindow(f, today)
  const out: Record<SubmissionStatusFilter, number> = { all: 0, new: 0, processed: 0, archived: 0 }
  for (const s of rows) {
    if (!matches(s, { ...f, status: 'all' }, q, win)) continue
    out.all += 1
    out[s.status] += 1
  }
  return out
}

export function isDefaultSubmissionFilters(f: SubmissionFilters): boolean {
  return !f.q.trim() && !f.form && f.status === 'all' && f.range === 'all' && !f.from && !f.to
}

/** Active filters besides search (the phone "Filters · N" count). */
export function activeSubmissionFilterCount(f: SubmissionFilters): number {
  return (f.form ? 1 : 0) + (f.status !== 'all' ? 1 : 0) + (f.range !== 'all' || f.from ? 1 : 0)
}

export function nextSubmissionSort(column: SubmissionSortColumn, current: SubmissionFilters['sort']): SubmissionFilters['sort'] {
  if (current.column !== column) return { column, dir: column === 'name' ? 'asc' : 'desc' }
  return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

/** Raw cell text (arrays joined with "; ", objects dropped). */
export function rawValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ')
  if (typeof v === 'object') return ''
  return String(v)
}

/** "Summary by": 'none', 'form', 'status' or one of the data keys. */
export type GroupBy = string

/** Counts per value of `groupBy` (array values count once per item), largest first. */
export function groupCounts(rows: DashboardSubmission[], groupBy: GroupBy): [string, number][] {
  if (groupBy === 'none') return []
  const counts = new Map<string, number>()
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)
  for (const r of rows) {
    if (groupBy === 'form') bump(r.formId)
    else if (groupBy === 'status') bump(r.status)
    else {
      const v = r.data[groupBy]
      if (Array.isArray(v)) v.forEach((x) => bump(String(x)))
      else bump(rawValue(v) || '—')
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Every data key any request has, sorted (the "Summary by" choices). */
export function dataKeys(rows: DashboardSubmission[]): string[] {
  const s = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.data)) s.add(k)
  return Array.from(s).sort()
}

/** The first line of what the visitor wrote (message-like fields first, else the longest text). */
export function firstLine(s: DashboardSubmission): string {
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

/** CSV cell: quotes/commas/newlines escaped, spreadsheet formulas neutralised. */
export function csvEscape(s: string): string {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** The CSV export (CRLF lines, no BOM): fixed columns, every data key, then every source key. */
export function submissionsCsv(list: DashboardSubmission[]): string {
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
  return lines.join('\r\n')
}
