import { describe, expect, it } from 'vitest'
import { SUPPORT_CARD_LINKS, adminViewQuery, applyAdminView, DEFAULT_ADMIN_VIEW, eventLine, isDefaultAdminView, parseAdminView, projectOptions } from '../admin-view'
import type { TicketSummary } from '../model'

const t = (id: string, o: Partial<TicketSummary>): TicketSummary => ({
  id, number: 1, reference: 'ABL-000001', title: id, status: 'open', createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-01T00:00:00Z',
  unread: false, createdBy: { id: 'u', name: 'U' }, severity: 'normal', project: { id: 'p1', slug: 'a', name: 'Alpha' }, ...o,
})

describe('parseAdminView', () => {
  it('defaults to Active, all projects, any severity', () => {
    expect(parseAdminView({})).toEqual(DEFAULT_ADMIN_VIEW)
    expect(isDefaultAdminView(parseAdminView(new URLSearchParams('')))).toBe(true)
  })
  it('reads known values and ignores unknown ones', () => {
    expect(parseAdminView({ status: 'resolved', severity: 'high', project: 'goro' })).toEqual({ project: 'goro', status: 'resolved', severity: 'high', unread: false, seen: '' })
    expect(parseAdminView({ status: 'bogus', severity: 'critical' })).toEqual(DEFAULT_ADMIN_VIEW)
    expect(parseAdminView({ status: ['all', 'open'] }).status).toBe('all')
  })
  it('round-trips through the query string, omitting defaults', () => {
    expect(adminViewQuery(DEFAULT_ADMIN_VIEW)).toBe('')
    const v = { project: 'a', status: 'all' as const, severity: 'low' as const, unread: true, seen: '1' as const }
    expect(parseAdminView(new URLSearchParams(adminViewQuery(v)))).toEqual(v)
  })
})

describe('applyAdminView', () => {
  const list = [
    t('old', { lastActivityAt: '2026-10-01T00:00:00Z' }),
    t('done', { status: 'resolved', lastActivityAt: '2026-10-05T00:00:00Z' }),
    t('new', { status: 'in_progress', severity: 'high', lastActivityAt: '2026-10-03T00:00:00Z', project: { id: 'p2', slug: 'b', name: 'Beta' } }),
  ]
  it('Active hides resolved and sorts by last activity', () => {
    expect(applyAdminView(list, DEFAULT_ADMIN_VIEW).map((x) => x.id)).toEqual(['new', 'old'])
  })
  it('All shows everything; a status shows only that status', () => {
    expect(applyAdminView(list, { ...DEFAULT_ADMIN_VIEW, status: 'all' }).map((x) => x.id)).toEqual(['done', 'new', 'old'])
    expect(applyAdminView(list, { ...DEFAULT_ADMIN_VIEW, status: 'resolved' }).map((x) => x.id)).toEqual(['done'])
  })
  it('filters by project and severity', () => {
    expect(applyAdminView(list, { ...DEFAULT_ADMIN_VIEW, project: 'b', status: 'all' }).map((x) => x.id)).toEqual(['new'])
    expect(applyAdminView(list, { ...DEFAULT_ADMIN_VIEW, status: 'all', severity: 'high' }).map((x) => x.id)).toEqual(['new'])
  })
  it('lists each project once', () => {
    expect(projectOptions(list)).toEqual([{ slug: 'a', name: 'Alpha' }, { slug: 'b', name: 'Beta' }])
  })
})

describe('eventLine', () => {
  it('names the new status and severity', () => {
    expect(eventLine('status_changed', 'in_progress')).toEqual({ key: 'statusChanged', values: { status: 'in_progress' } })
    expect(eventLine('severity_changed', 'high')).toEqual({ key: 'severityChanged', values: { severity: 'high' } })
  })
  it('skips lines it cannot word', () => {
    expect(eventLine('status_changed', 'nonsense')).toBeNull()
    expect(eventLine('created', null)).toBeNull()
  })
  it('words the plain events', () => {
    expect(eventLine('reopened_by_reply', null)?.key).toBe('reopenedByReply')
    expect(eventLine('attachment_deleted', 'redacted')?.key).toBe('attachmentDeleted')
    expect(eventLine('support_visit_started', null)?.key).toBe('supportVisitStarted')
    expect(eventLine('message_redacted', null)?.key).toBe('messageRedacted')
  })
})

describe('unread filter and Support card links', () => {
  const list = [t('seen', { status: 'open', seen: true }), t('fresh', { status: 'open', unread: true, seen: false }), t('fresh-wait', { status: 'waiting_for_user', unread: true, seen: true })]
  it('unread=1 keeps only tickets with unseen activity', () => {
    expect(parseAdminView({ unread: '1' }).unread).toBe(true)
    expect(parseAdminView({ unread: 'yes' }).unread).toBe(false)
    expect(isDefaultAdminView(parseAdminView({ unread: '1' }))).toBe(false)
    expect(applyAdminView(list, { ...DEFAULT_ADMIN_VIEW, unread: true }).map((x) => x.id).sort()).toEqual(['fresh', 'fresh-wait'])
  })
  it('every card link parses to the filter its number counts', () => {
    const q = (href: string) => parseAdminView(new URLSearchParams(href.split('?')[1]))
    expect(applyAdminView(list, q(SUPPORT_CARD_LINKS.new)).map((x) => x.id)).toEqual(['fresh'])
    expect(applyAdminView(list, q(SUPPORT_CARD_LINKS.waiting)).map((x) => x.id)).toEqual(['fresh-wait'])
    expect(q(SUPPORT_CARD_LINKS.high)).toEqual({ ...DEFAULT_ADMIN_VIEW, severity: 'high' })
  })
})

describe('seen filter (round 4)', () => {
  const list = [
    t('new', { status: 'open', seen: false, unread: true }),
    t('replied', { status: 'open', seen: true, unread: true }),
    t('read', { status: 'open', seen: true, unread: false }),
    t('legacy', { status: 'open' }),
  ]
  const q = (href: string) => parseAdminView(new URLSearchParams(href.split('?')[1]))
  it('parses seen=0 / seen=1 and ignores anything else', () => {
    expect(parseAdminView({ seen: '0' }).seen).toBe('0')
    expect(parseAdminView({ seen: '1' }).seen).toBe('1')
    expect(parseAdminView({ seen: 'x' }).seen).toBe('')
    expect(isDefaultAdminView(parseAdminView({ seen: '0' }))).toBe(false)
    expect(adminViewQuery({ ...DEFAULT_ADMIN_VIEW, seen: '0' })).toBe('?seen=0')
  })
  it('seen=0 keeps only never-opened tickets', () => {
    expect(applyAdminView(list, { ...DEFAULT_ADMIN_VIEW, seen: '0' }).map((x) => x.id).sort()).toEqual(['legacy', 'new'])
  })
  it('New link lists what newCount counts, Replied link what repliedCount counts', () => {
    expect(applyAdminView(list, q(SUPPORT_CARD_LINKS.new)).map((x) => x.id).sort()).toEqual(['legacy', 'new'])
    expect(applyAdminView(list, q(SUPPORT_CARD_LINKS.replied)).map((x) => x.id)).toEqual(['replied'])
  })
})

describe('event lines for round 3', () => {
  it('words a screenshot removed by the client and a partial redaction', () => {
    expect(eventLine('attachment_deleted', 'removed_by_client')).toEqual({ key: 'attachmentRemovedByClient' })
    expect(eventLine('attachment_deleted', null)).toEqual({ key: 'attachmentDeleted' })
    expect(eventLine('message_redacted', 'partial:11')).toEqual({ key: 'messageRedactedPartial', values: { count: '11' } })
    expect(eventLine('message_redacted', null)).toEqual({ key: 'messageRedacted' })
  })
})
