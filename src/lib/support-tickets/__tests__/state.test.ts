import { describe, expect, it } from 'vitest'
import { adminStatusTargets, attachmentExpiry, clientReplyOutcome, isUnread } from '../state'
import { formatTicketNumber, parseTicketNumber, validateBody, validateTitle, failureFromDbError } from '../model'

const DAY = 86_400_000
const now = Date.parse('2026-10-22T10:00:00Z')

describe('client reply (ADR-039 D4)', () => {
  it('waiting_for_user → open', () => {
    expect(clientReplyOutcome('waiting_for_user', null, now)).toEqual({ allowed: true, nextStatus: 'open', reopened: false })
  })
  it('open / in_progress unchanged', () => {
    expect(clientReplyOutcome('open', null, now)).toEqual({ allowed: true, nextStatus: 'open', reopened: false })
    expect(clientReplyOutcome('in_progress', null, now)).toEqual({ allowed: true, nextStatus: 'in_progress', reopened: false })
  })
  it('resolved within 14 days reopens', () => {
    expect(clientReplyOutcome('resolved', new Date(now - 13 * DAY).toISOString(), now)).toEqual({ allowed: true, nextStatus: 'open', reopened: true })
  })
  it('resolved more than 14 days ago is closed', () => {
    expect(clientReplyOutcome('resolved', new Date(now - 15 * DAY).toISOString(), now)).toEqual({ allowed: false, reason: 'closed' })
    expect(clientReplyOutcome('resolved', null, now)).toEqual({ allowed: false, reason: 'closed' })
  })
})

describe('admin + retention + unread', () => {
  it('admin can move to any other status', () => {
    expect(adminStatusTargets('resolved')).toEqual(['open', 'in_progress', 'waiting_for_user'])
  })
  it('screenshots expire 90 days after resolution', () => {
    expect(attachmentExpiry('2026-01-01T00:00:00.000Z')).toBe('2026-04-01T00:00:00.000Z')
  })
  it('unread when activity is newer than the read mark, or never read', () => {
    expect(isUnread('2026-10-22T10:00:00Z', null)).toBe(true)
    expect(isUnread('2026-10-22T10:00:00Z', '2026-10-22T09:00:00Z')).toBe(true)
    expect(isUnread('2026-10-22T10:00:00Z', '2026-10-22T10:00:00Z')).toBe(false)
  })
})

describe('model', () => {
  it('ticket numbers', () => {
    expect(formatTicketNumber(124)).toBe('ABL-000124')
    expect(formatTicketNumber(1234567)).toBe('ABL-1234567')
    expect(parseTicketNumber('ABL-000124')).toBe(124)
    expect(parseTicketNumber('abl-124')).toBe(124)
    expect(parseTicketNumber('ABL-')).toBeNull()
    expect(parseTicketNumber('x1')).toBeNull()
  })
  it('validation', () => {
    expect(validateTitle('  ')).toBe('titleRequired')
    expect(validateTitle('a'.repeat(121))).toBe('titleTooLong')
    expect(validateTitle('Publish button')).toBeNull()
    expect(validateBody('')).toBe('bodyRequired')
    expect(validateBody('a'.repeat(10_001))).toBe('bodyTooLong')
  })
  it('database errors map to stable reasons', () => {
    expect(failureFromDbError({ code: '42P01' })).toBe('unavailable')
    expect(failureFromDbError({ code: 'PGRST205' })).toBe('unavailable')
    expect(failureFromDbError({ code: 'P0001', message: 'support_ticket:rate_limited' })).toBe('rateLimited')
    expect(failureFromDbError({ code: 'P0001', message: 'support_ticket:closed' })).toBe('closed')
    expect(failureFromDbError({ code: '23514' })).toBe('invalid')
    expect(failureFromDbError({ code: 'XX000', message: 'boom' })).toBe('error')
  })
})
