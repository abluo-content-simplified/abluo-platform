import { describe, expect, it } from 'vitest'
import { buildClientNotices, noticeReaches, validateNotice, type NoticeRow } from '../notices'
import { ackReport, expectedPeople } from '../acks'

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const U1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const U2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

describe('notice audience (ADR-050 D8)', () => {
  const viewer = (projectId: string, userId: string, mods: string[] = []) => ({ projectId, userId, enabledModuleIds: mods })
  it('everyone / modules as in migration 045', () => {
    expect(noticeReaches({}, viewer(P1, U1))).toBe(true)
    expect(noticeReaches({ modules: ['blog'] }, viewer(P1, U1, ['events']))).toBe(false)
    expect(noticeReaches({ modules: ['blog'] }, viewer(P1, U1, ['blog']))).toBe(true)
  })
  it('a person-aimed notice shows on every site of that person; a site-aimed one on that site', () => {
    expect(noticeReaches({ users: [U1] }, viewer(P2, U1))).toBe(true)
    expect(noticeReaches({ users: [U1] }, viewer(P1, U2))).toBe(false)
    expect(noticeReaches({ projects: [P1] }, viewer(P1, U2))).toBe(true)
    expect(noticeReaches({ projects: [P1] }, viewer(P2, U2))).toBe(false)
  })
  it('specific targeting wins over modules', () => {
    expect(noticeReaches({ projects: [P1], modules: ['blog'] }, viewer(P1, U1, []))).toBe(true)
  })
})

describe('banner rows', () => {
  const base: NoticeRow = {
    id: 'n1', status: 'published', message: { en: 'Maintenance' }, tone: 'info', starts_at: '2026-11-10T00:00:00Z', ends_at: '2026-11-11T00:00:00Z',
    audience: {}, created_at: '', updated_at: '', body: { en: 'Details here' }, requires_ack: true,
  }
  const opts = { locale: 'en', enabledModuleIds: [], dismissedIds: new Set<string>(), now: Date.parse('2026-11-10T12:00:00Z'), projectId: P1, userId: U1 }
  it('a notice asking for confirmation is not dismissible and carries its read-more text', () => {
    const [n] = buildClientNotices([base], opts)
    expect(n).toMatchObject({ dismissible: false, requiresAck: true, body: 'Details here' })
  })
  it('disappears once acknowledged', () => {
    expect(buildClientNotices([base], { ...opts, acknowledgedIds: new Set(['n1']) })).toEqual([])
  })
  it('works with migration 045 rows (no body / requires_ack)', () => {
    const { body: _b, requires_ack: _r, ...old } = base
    void _b
    void _r
    expect(buildClientNotices([old as NoticeRow], opts)[0]).toMatchObject({ dismissible: true, requiresAck: false, body: null })
  })
})

describe('validateNotice with targets', () => {
  const input = { message: { en: 'Hi' }, tone: 'info' as const, startsAt: '2026-11-10T00:00:00Z', endsAt: '2026-11-12T00:00:00Z', modules: ['blog'] }
  it('stores projects / users instead of modules when given', () => {
    const r = validateNotice({ ...input, projects: [P1], requiresAck: true }, { knownModules: ['blog'], publishing: true, now: Date.parse('2026-11-10T01:00:00Z'), knownProjects: [P1] })
    expect(r.ok && r.values.audience).toEqual({ projects: [P1] })
    expect(r.ok && r.values.requires_ack).toBe(true)
  })
  it('refuses unknown targets and an over-long read-more text', () => {
    const r = validateNotice({ ...input, users: [U2], body: { en: 'x'.repeat(4001) } }, { knownModules: ['blog'], publishing: false, now: 0, knownUsers: [U1] })
    expect(r.ok ? [] : r.errors).toEqual(expect.arrayContaining(['unknownTarget', 'bodyTooLong']))
  })
})

describe('acknowledgements', () => {
  const sites = [
    { id: P1, name: 'One', people: [{ userId: U1, name: 'Ann', email: 'a@x', role: 'owner' }] },
    { id: P2, name: 'Two', people: [{ userId: U2, name: 'Ben', email: 'b@x', role: 'editor' }] },
  ]
  it('expected people: site members + named people; unknown for a module audience', () => {
    expect(expectedPeople({ projects: [P1], users: [U2] }, sites)?.map((p) => [p.userId, p.projectId])).toEqual([[U1, P1], [U2, P2]])
    expect(expectedPeople({ modules: ['blog'] }, sites)).toBeNull()
    expect(expectedPeople({}, sites)?.length).toBe(2)
  })
  it('report: who confirmed, who not yet', () => {
    const r = ackReport({}, [{ user_id: U1, acknowledged_at: '2026-11-10T10:00:00Z' }], sites)
    expect(r.acknowledged.map((a) => a.name)).toEqual(['Ann'])
    expect(r.pending?.map((p) => p.name)).toEqual(['Ben'])
  })
})
