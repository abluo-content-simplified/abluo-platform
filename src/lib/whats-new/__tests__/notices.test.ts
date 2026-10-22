import { describe, expect, it } from 'vitest'
import {
  buildClientNotices,
  isNoticeActive,
  isNoticeDismissible,
  nextNoticeStatus,
  stillActive,
  validateNotice,
  type NoticeInput,
  type NoticeRow,
} from '../notices'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const HOUR = 3600_000
const iso = (ms: number) => new Date(ms).toISOString()

const row = (id: string, over: Partial<NoticeRow> = {}): NoticeRow => ({
  id,
  status: 'published',
  message: { en: `msg ${id}`, it: `msg it ${id}` },
  tone: 'info',
  starts_at: iso(NOW - HOUR),
  ends_at: iso(NOW + HOUR),
  audience: {},
  created_at: iso(NOW - 2 * HOUR),
  updated_at: iso(NOW - 2 * HOUR),
  ...over,
})
const opts = { locale: 'en', enabledModuleIds: [] as string[], dismissedIds: new Set<string>(), now: NOW }

describe('isNoticeActive', () => {
  it('start inclusive, end exclusive', () => {
    expect(isNoticeActive(iso(NOW), iso(NOW + HOUR), NOW)).toBe(true)
    expect(isNoticeActive(iso(NOW - HOUR), iso(NOW), NOW)).toBe(false)
    expect(isNoticeActive(iso(NOW + 1), iso(NOW + HOUR), NOW)).toBe(false)
  })
  it('bad dates are never active', () => {
    expect(isNoticeActive('nope', iso(NOW + HOUR), NOW)).toBe(false)
  })
})

describe('buildClientNotices', () => {
  it('shows a published notice inside its window', () => {
    expect(buildClientNotices([row('a')], opts).map((n) => n.id)).toEqual(['a'])
  })
  it('hides drafts, archived, not-yet-started and ended notices', () => {
    const rows = [
      row('draft', { status: 'draft' }),
      row('arch', { status: 'archived' }),
      row('future', { starts_at: iso(NOW + HOUR), ends_at: iso(NOW + 2 * HOUR) }),
      row('past', { starts_at: iso(NOW - 3 * HOUR), ends_at: iso(NOW - HOUR) }),
    ]
    expect(buildClientNotices(rows, opts)).toEqual([])
  })
  it('respects the audience (modules) like product updates', () => {
    const r = row('ev', { audience: { modules: ['events'] } })
    expect(buildClientNotices([r], { ...opts, enabledModuleIds: ['blog'] })).toEqual([])
    expect(buildClientNotices([r], { ...opts, enabledModuleIds: ['events'] })).toHaveLength(1)
    expect(buildClientNotices([row('all')], { ...opts, enabledModuleIds: [] })).toHaveLength(1)
  })
  it('picks the viewer language, falls back to English, skips empty messages', () => {
    expect(buildClientNotices([row('a')], { ...opts, locale: 'it' })[0].message).toBe('msg it a')
    expect(buildClientNotices([row('a')], { ...opts, locale: 'de' })[0].lang).toBe('en')
    expect(buildClientNotices([row('a', { message: {} })], opts)).toEqual([])
  })
  it('an info notice can be dismissed and then stays hidden', () => {
    const n = buildClientNotices([row('a')], opts)[0]
    expect(n.dismissible).toBe(true)
    expect(buildClientNotices([row('a')], { ...opts, dismissedIds: new Set(['a']) })).toEqual([])
  })
  it('a warning is not dismissible, even if a dismissal row exists', () => {
    const w = row('w', { tone: 'warning' })
    const [n] = buildClientNotices([w], { ...opts, dismissedIds: new Set(['w']) })
    expect(n.dismissible).toBe(false)
    expect(n.tone).toBe('warning')
  })
  it('warnings come first, then the most recently started', () => {
    const rows = [
      row('info-old', { starts_at: iso(NOW - 5 * HOUR) }),
      row('info-new', { starts_at: iso(NOW - HOUR) }),
      row('warn', { tone: 'warning', starts_at: iso(NOW - 10 * HOUR) }),
    ]
    expect(buildClientNotices(rows, opts).map((n) => n.id)).toEqual(['warn', 'info-new', 'info-old'])
  })
})

describe('stillActive (browser re-check)', () => {
  it('drops a notice once its end passes and an info one once closed', () => {
    const list = buildClientNotices([row('a'), row('w', { tone: 'warning' })], opts)
    expect(stillActive(list, NOW).map((n) => n.id).sort()).toEqual(['a', 'w'])
    expect(stillActive(list, NOW + 2 * HOUR)).toEqual([])
    expect(stillActive(list, NOW, new Set(['a', 'w'])).map((n) => n.id)).toEqual(['w'])
  })
})

describe('isNoticeDismissible', () => {
  it('info yes, warning no', () => {
    expect(isNoticeDismissible('info')).toBe(true)
    expect(isNoticeDismissible('warning')).toBe(false)
  })
})

describe('validateNotice', () => {
  const input: NoticeInput = {
    message: { en: ' Maintenance tonight ' },
    tone: 'warning',
    startsAt: iso(NOW + HOUR),
    endsAt: iso(NOW + 2 * HOUR),
    modules: [],
  }
  const o = { knownModules: ['events', 'blog'], publishing: true, now: NOW }
  it('accepts and normalises', () => {
    const r = validateNotice({ ...input, modules: ['events', 'events'] }, o)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.values.message).toEqual({ en: 'Maintenance tonight' })
      expect(r.values.audience).toEqual({ modules: ['events'] })
    }
  })
  it('needs a message, a start and an end, end after start', () => {
    const r = validateNotice({ ...input, message: {}, startsAt: null, endsAt: null }, o)
    expect(r).toEqual({ ok: false, errors: ['messageRequired', 'startRequired', 'endRequired'] })
    const e = validateNotice({ ...input, endsAt: input.startsAt }, o)
    expect(e.ok).toBe(false)
    if (!e.ok) expect(e.errors).toContain('endBeforeStart')
  })
  it('refuses to publish a notice that has already ended, but a draft may', () => {
    const past = { ...input, startsAt: iso(NOW - 3 * HOUR), endsAt: iso(NOW - HOUR) }
    const pub = validateNotice(past, o)
    expect(pub.ok === false && pub.errors).toContain('endInPast')
    expect(validateNotice(past, { ...o, publishing: false }).ok).toBe(true)
  })
  it('rejects unknown modules and over-long messages', () => {
    const r = validateNotice({ ...input, modules: ['nope'], message: { en: 'x'.repeat(401) } }, o)
    expect(r.ok === false && r.errors).toEqual(expect.arrayContaining(['unknownModule', 'messageTooLong']))
  })
})

describe('nextNoticeStatus', () => {
  it('maps intents; save keeps the current status', () => {
    expect(nextNoticeStatus('publish', 'draft')).toBe('published')
    expect(nextNoticeStatus('archive', 'published')).toBe('archived')
    expect(nextNoticeStatus('draft', 'archived')).toBe('draft')
    expect(nextNoticeStatus('save', 'published')).toBe('published')
    expect(nextNoticeStatus('save', null)).toBe('draft')
  })
})
