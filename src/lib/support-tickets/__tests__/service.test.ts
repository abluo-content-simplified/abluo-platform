/**
 * The client door of the service never reads internal data (ADR-039 D7):
 * a static check on the source, plus the pure thread builder.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildThread, prepareAttachments } from '../service'

const SRC = readFileSync(join(process.cwd(), 'src/lib/support-tickets/service.ts'), 'utf8')
function body(name: string): string {
  const start = SRC.indexOf(`export async function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const next = SRC.indexOf('\nexport ', start + 10)
  return SRC.slice(start, next === -1 ? undefined : next)
}

describe('client paths never touch internal data', () => {
  for (const fn of ['listClientTickets', 'getClientTicket', 'createTicket', 'replyAsClient', 'countClientUnread', 'clientTicketAttention', 'deleteOwnAttachment']) {
    it(fn, () => {
      const b = body(fn)
      expect(b).not.toContain('support_ticket_notes')
      expect(b).not.toContain('ADMIN_TICKET_COLUMNS')
      expect(b).not.toMatch(/severity/)
    })
  }
  it('the client ticket read filters events to public', () => {
    expect(body('getClientTicket')).toContain(".eq('visibility', 'public')")
  })
  it('client column list carries no severity or context', () => {
    const cols = /const CLIENT_TICKET_COLUMNS = '([^']+)'/.exec(SRC)![1]
    expect(cols).not.toMatch(/severity|context/)
  })
})

describe('buildThread', () => {
  const people = new Map([['c1', { id: 'c1', name: 'Paolo' }], ['a1', { id: 'a1', name: 'Tom' }]])
  const base = {
    messages: [
      { id: 'm1', ticket_id: 't', author_id: 'c1', author_kind: 'client' as const, body: 'Help', created_at: '2026-10-22T10:42:00Z', redacted_at: null },
      { id: 'm2', ticket_id: 't', author_id: 'a1', author_kind: 'support' as const, body: 'Looking', created_at: '2026-10-22T11:05:00Z', redacted_at: null },
      { id: 'm3', ticket_id: 't', author_id: 'c1', author_kind: 'client' as const, body: 'secret', created_at: '2026-10-22T11:18:00Z', redacted_at: '2026-10-22T12:00:00Z' },
    ],
    notes: [{ id: 'n1', ticket_id: 't', author_id: 'a1', body: 'internal', created_at: '2026-10-22T11:00:00Z' }],
    events: [
      { id: 'e0', ticket_id: 't', actor_id: 'c1', kind: 'created' as const, from_value: null, to_value: 'open', visibility: 'internal' as const, created_at: '2026-10-22T10:42:00Z' },
      { id: 'e1', ticket_id: 't', actor_id: 'a1', kind: 'status_changed' as const, from_value: 'open', to_value: 'in_progress', visibility: 'public' as const, created_at: '2026-10-22T11:04:00Z' },
    ],
    people,
    byMessage: new Map([['', [{ id: 'x', mime: 'image/png', bytes: 1, width: 1, height: 1, url: 'u', deleted: null }]]]),
    firstMessageId: 'm1',
  }
  it('admin: chronological, notes included, names shown', () => {
    const t = buildThread({ ...base, hideSupportNames: false })
    expect(t.map((e) => e.id)).toEqual(['m1', 'n1', 'e1', 'm2', 'm3'])
    expect(t.find((e) => e.id === 'm2')).toMatchObject({ author: { name: 'Tom' } })
  })
  it('client: support names hidden, redacted text empty, unlinked screenshots on the first message', () => {
    const t = buildThread({ ...base, notes: [], hideSupportNames: true })
    expect(t.find((e) => e.id === 'm2')).toMatchObject({ author: { id: null, name: '' } })
    expect(t.find((e) => e.id === 'm3')).toMatchObject({ body: '', redacted: true })
    expect(t.find((e) => e.id === 'e1')).toMatchObject({ actor: null })
    expect((t[0] as { attachments: unknown[] }).attachments).toHaveLength(1)
  })
})

describe('prepareAttachments', () => {
  it('refuses more than 3, oversize and non-images', () => {
    const f = (n: number, bytes = Uint8Array.of(1)) => Array.from({ length: n }, (_, i) => ({ name: `${i}.png`, type: 'image/png', bytes }))
    expect(prepareAttachments(f(4))).toMatchObject({ ok: false, reason: 'tooManyAttachments' })
    expect(prepareAttachments(f(1, new Uint8Array(5 * 1024 * 1024 + 1)))).toMatchObject({ ok: false, reason: 'attachmentTooLarge' })
    expect(prepareAttachments(f(1, Uint8Array.from('<svg/>', (c) => c.charCodeAt(0))))).toMatchObject({ ok: false, reason: 'attachmentType' })
    expect(prepareAttachments([])).toMatchObject({ ok: true })
  })
})
