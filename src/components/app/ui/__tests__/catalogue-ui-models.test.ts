/**
 * R2-K pure helpers: schedule words (24-hour, Monday first, overnight) and
 * tree gestures → C1 MoveRequest (cycle refusal stays C1 validateMove's).
 */
import { describe, expect, it } from 'vitest'
import { buildTree, validateMove } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'
import { daysText, isOvernight, issueMessageKey, ruleSummary, timeText, weekdayNames, windowsSummary, type ScheduleT } from '../schedule-model'
import { dropRequest, fullPath, positionOf, stepRequest } from '../tree-model'
import en from '../../../../../messages/en.json'

const S = en.app.ui.schedule as unknown as Record<string, string>
const t: ScheduleT = (k, v = {}) => S[k].replace(/\{(\w+)\}/g, (_, n) => String(v[n]))
const names = weekdayNames('en')

describe('schedule-model', () => {
  it('weekday names start on Monday and follow the locale', () => {
    expect(Object.values(weekdayNames('en'))[0]).toBe('Mon')
    expect(Object.values(weekdayNames('de'))[0]).toMatch(/^Mo/)
    expect(Object.values(weekdayNames('it'))[6]).toMatch(/^dom/)
  })

  it('days collapse into ranges; none or all seven = every day', () => {
    expect(daysText([], names, t)).toBe('every day')
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], names, t)).toBe('every day')
    expect(daysText(['mon', 'tue', 'wed', 'thu', 'fri'], names, t)).toBe('Mon–Fri')
    expect(daysText(['sun', 'sat'], names, t)).toBe('Sat, Sun')
  })

  it('times stay 24-hour; to before from is overnight; equal is not', () => {
    expect(timeText('18:00', '23:00', t)).toBe('18:00–23:00')
    expect(timeText('22:00', '02:00', t)).toBe('22:00–02:00 overnight')
    expect(timeText(null, null, t)).toBe('all day')
    expect(isOvernight('22:00', '02:00')).toBe(true)
    expect(isOvernight('10:00', '10:00')).toBe(false)
  })

  it('summaries read as sentences (the brief example)', () => {
    expect(ruleSummary({ state: 'unavailable', overrides: [{ kind: 'weekly', key: 'a', days: [], from: '18:00', to: '23:00', state: 'available' }] }, names, t)).toBe('Available 18:00–23:00 every day')
    expect(ruleSummary({ state: 'available', overrides: [] }, names, t)).toBe('Available all week')
    expect(ruleSummary({ state: 'available', overrides: [{ kind: 'weekly', key: 'a', days: ['sun'], from: null, to: null, state: 'unavailable' }] }, names, t)).toBe('Unavailable all day Sun, otherwise available')
    expect(windowsSummary([], names, t)).toBe('Always')
  })

  it('issue codes map to message keys without dots', () => {
    expect(issueMessageKey('availability.scheduleOverlap')).toBe('scheduleOverlap')
    expect(issueMessageKey('price.windowIncomplete')).toBe('windowIncomplete')
  })
})

const n = (key: string, parentKey: string | null, order: number): CategoryNode => ({ key, label: { en: key[0].toUpperCase() + key.slice(1) }, parentKey, order, channelRules: {}, defaultOptionListIds: [], archivedAt: null })
const tree = buildTree([n('food', null, 1), n('pizza', 'food', 1), n('bianche', 'pizza', 1), n('pasta', 'food', 2), n('drinks', null, 2)])
const label = (k: string) => tree.nodes.get(k)!.label.en!

describe('tree-model', () => {
  it('steps: up / down within siblings, indent into the previous sibling, outdent after the parent', () => {
    expect(stepRequest(tree, 'pasta', 'up')).toEqual({ ok: true, request: { key: 'pasta', newParentKey: 'food', index: 0 } })
    expect(stepRequest(tree, 'pizza', 'up')).toEqual({ ok: false, blocked: 'first' })
    expect(stepRequest(tree, 'pasta', 'down')).toEqual({ ok: false, blocked: 'last' })
    expect(stepRequest(tree, 'pasta', 'indent')).toEqual({ ok: true, request: { key: 'pasta', newParentKey: 'pizza', index: 1 } })
    expect(stepRequest(tree, 'pizza', 'indent')).toEqual({ ok: false, blocked: 'noPrevious' })
    expect(stepRequest(tree, 'bianche', 'outdent')).toEqual({ ok: true, request: { key: 'bianche', newParentKey: 'food', index: 1 } })
    expect(stepRequest(tree, 'food', 'outdent')).toEqual({ ok: false, blocked: 'topLevel' })
  })

  it('a drop beside a row in another parent re-parents; dropping a node beside its own descendant is refused by C1', () => {
    expect(dropRequest(tree, 'drinks', { key: 'pasta', after: true })).toEqual({ key: 'drinks', newParentKey: 'food', index: 2 })
    const cyclic = dropRequest(tree, 'food', { key: 'bianche', after: false })
    expect(cyclic).toEqual({ key: 'food', newParentKey: 'pizza', index: 0 })
    expect(validateMove(tree, cyclic!)).toMatchObject({ ok: false, code: 'category_cycle' })
    expect(dropRequest(tree, 'pizza', { key: 'pasta', after: false })).toBeNull()
  })

  it('full paths and positions', () => {
    expect(fullPath(tree, 'bianche', label)).toBe('Food › Pizza › Bianche')
    expect(positionOf(tree, 'pasta')).toEqual({ position: 2, total: 2 })
  })
})
