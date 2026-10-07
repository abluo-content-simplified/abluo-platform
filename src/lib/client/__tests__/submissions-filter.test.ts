import { describe, expect, it } from 'vitest'
import type { DashboardSubmission } from '@/lib/api/client-dashboard'
import {
  activeSubmissionFilterCount,
  applySubmissionFilters,
  csvEscape,
  DEFAULT_SUBMISSION_FILTERS as D,
  firstLine,
  groupCounts,
  isDefaultSubmissionFilters,
  nextSubmissionSort,
  submissionsCsv,
  submissionStatusCounts,
} from '../submissions-filter'

const s = (over: Partial<DashboardSubmission>): DashboardSubmission => ({
  id: 'x',
  formId: 'contact',
  name: null,
  email: null,
  status: 'new',
  createdAt: '2026-10-05T12:00:00',
  data: {},
  source: null,
  formVersion: 1,
  locale: 'it',
  consentAt: null,
  ...over,
})

const TODAY = '2026-10-07'
const rows = [
  s({ id: 'a', name: 'Anna', email: 'anna@x.it', createdAt: '2026-10-06T12:00:00', data: { message: 'Vorrei un appuntamento', topic: ['ansia', 'sonno'] } }),
  s({ id: 'b', name: 'bruno', email: 'b@x.it', status: 'processed', createdAt: '2026-09-20T12:00:00', data: { subject: 'Prezzi' } }),
  s({ id: 'c', email: 'c@x.it', formId: 'early-access', status: 'archived', createdAt: '2025-12-31T12:00:00', data: { topic: 'ansia' } }),
]
const ids = (f = D) => applySubmissionFilters(rows, f, TODAY).map((r) => r.id)

describe('submissions filters', () => {
  it('defaults: everything, newest first', () => {
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(isDefaultSubmissionFilters(D)).toBe(true)
    expect(activeSubmissionFilterCount(D)).toBe(0)
  })

  it('search covers name, email and what they sent (case-insensitive)', () => {
    expect(ids({ ...D, q: 'ANNA' })).toEqual(['a'])
    expect(ids({ ...D, q: 'c@x' })).toEqual(['c'])
    expect(ids({ ...D, q: 'appuntamento' })).toEqual(['a'])
    expect(ids({ ...D, q: 'sonno' })).toEqual(['a'])
    expect(ids({ ...D, q: 'prezzi' })).toEqual(['b'])
  })

  it('form and status', () => {
    expect(ids({ ...D, form: 'early-access' })).toEqual(['c'])
    expect(ids({ ...D, status: 'processed' })).toEqual(['b'])
    expect(activeSubmissionFilterCount({ ...D, form: 'x', status: 'new', range: 'last7' })).toBe(3)
  })

  it('received date: presets and a custom range', () => {
    expect(ids({ ...D, range: 'last7' })).toEqual(['a'])
    expect(ids({ ...D, range: 'last30' })).toEqual(['a', 'b'])
    expect(ids({ ...D, range: 'thisYear' })).toEqual(['a', 'b'])
    expect(ids({ ...D, from: '2025-12-31', to: '2025-12-31' })).toEqual(['c'])
    expect(ids({ ...D, from: '2026-09-20' })).toEqual(['b'])
    expect(isDefaultSubmissionFilters({ ...D, range: 'last7' })).toBe(false)
  })

  it('sort by received and by name', () => {
    expect(ids({ ...D, sort: { column: 'received', dir: 'asc' } })).toEqual(['c', 'b', 'a'])
    expect(ids({ ...D, sort: { column: 'name', dir: 'asc' } })).toEqual(['a', 'b', 'c'])
    expect(nextSubmissionSort('name', D.sort)).toEqual({ column: 'name', dir: 'asc' })
    expect(nextSubmissionSort('received', D.sort)).toEqual({ column: 'received', dir: 'asc' })
  })

  it('status counts ignore the status filter but keep the others', () => {
    expect(submissionStatusCounts(rows, { ...D, status: 'new' }, TODAY)).toEqual({ all: 3, new: 1, processed: 1, archived: 1 })
    expect(submissionStatusCounts(rows, { ...D, range: 'last30' }, TODAY)).toEqual({ all: 2, new: 1, processed: 1, archived: 0 })
  })
})

describe('summary, first line and CSV', () => {
  it('groups by form, status and a data key (arrays count per item)', () => {
    expect(groupCounts(rows, 'none')).toEqual([])
    expect(groupCounts(rows, 'form')).toEqual([['contact', 2], ['early-access', 1]])
    expect(groupCounts(rows, 'topic')).toEqual([['ansia', 2], ['—', 1], ['sonno', 1]])
  })

  it('first line prefers message-like fields', () => {
    expect(firstLine(rows[0])).toBe('Vorrei un appuntamento')
    expect(firstLine(s({ data: { name: 'Long name here', note2: 'hi\nthere' } }))).toBe('hi')
  })

  it('CSV escapes quotes and neutralises formulas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)")
    const csv = submissionsCsv([rows[0]]).split('\r\n')
    expect(csv[0]).toBe('id,form,status,received,locale,message,topic')
    expect(csv[1]).toContain('ansia; sonno')
  })
})
