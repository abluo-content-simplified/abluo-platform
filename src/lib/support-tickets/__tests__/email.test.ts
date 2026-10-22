import { describe, expect, it } from 'vitest'
import { chooseAdminEmails, chooseEmailLocale, recipientKindFor, renderTicketEmail, ticketUrl, type TicketEventType } from '../email'
import { isProductionEnvironment } from '@/lib/notifications/environment'

const EVENTS: TicketEventType[] = ['ticket.created', 'ticket.client_replied', 'ticket.support_replied', 'ticket.resolved']

describe('recipients', () => {
  it('routes events per ADR-039 D13', () => {
    expect(recipientKindFor('ticket.created')).toBe('admins')
    expect(recipientKindFor('ticket.client_replied')).toBe('admins')
    expect(recipientKindFor('ticket.support_replied')).toBe('creator')
    expect(recipientKindFor('ticket.resolved')).toBe('creator')
  })
  const users = [
    { email: 'Tom@tmz.it', app_metadata: { platform_role: 'abluo_admin' } },
    { email: 'client@x.it', app_metadata: {} },
    { email: null, app_metadata: { platform_role: 'abluo_admin' } },
    { email: 'tom@tmz.it', app_metadata: { platform_role: 'abluo_admin' } },
  ]
  it('uses the env list when set', () => {
    expect(chooseAdminEmails('a@b.it, c@d.it ,bad', users)).toEqual(['a@b.it', 'c@d.it'])
  })
  it('falls back to abluo_admin users, deduped', () => {
    expect(chooseAdminEmails(undefined, users)).toEqual(['tom@tmz.it'])
    expect(chooseAdminEmails('  ', users)).toEqual(['tom@tmz.it'])
  })
})

describe('language', () => {
  it('prefers the ticket interface language, then project default, then English', () => {
    expect(chooseEmailLocale({ interfaceLocale: 'de', projectDefaultLocale: 'it' })).toBe('de')
    expect(chooseEmailLocale({ interfaceLocale: 'it-IT', projectDefaultLocale: 'de' })).toBe('it')
    expect(chooseEmailLocale({ interfaceLocale: 'fr', projectDefaultLocale: 'it' })).toBe('it')
    expect(chooseEmailLocale({ interfaceLocale: undefined, projectDefaultLocale: 'pt' })).toBe('en')
    expect(chooseEmailLocale({})).toBe('en')
  })
})

describe('links', () => {
  it('builds client and admin links', () => {
    expect(ticketUrl('creator', 'abc', 'hoffmann')).toBe('https://abluo.app/hoffmann/support/abc')
    expect(ticketUrl('admins', 'abc', 'hoffmann')).toBe('https://admin.abluo.app/support/abc')
  })
})

describe('rendered email', () => {
  const TITLE = 'Mario Rossi psoriasi'
  for (const locale of ['en', 'it', 'de'] as const) {
    for (const eventType of EVENTS) {
      it(`${locale} ${eventType}: reference + link, no content`, () => {
        const url = ticketUrl(recipientKindFor(eventType), 'tid', 'proj')
        // The input type has no title/body field, so content cannot reach the email.
        const m = renderTicketEmail({ eventType, locale, reference: 'ABL-000124', projectName: 'Studio <Rossi>', url })
        for (const part of [m.subject, m.html, m.text]) {
          expect(part).toContain('ABL-000124')
          expect(part).not.toContain(TITLE)
        }
        expect(m.subject.startsWith('[ABL-000124]')).toBe(true)
        expect(m.html).toContain(url)
        expect(m.text).toContain(url)
        expect(m.html).not.toContain('<Rossi>')
        expect(m.html).toContain('&lt;Rossi&gt;')
        expect(m.html).not.toMatch(/\{\w+\}/)
      })
    }
  }
})

describe('environment gate', () => {
  it('only production delivers', () => {
    expect(isProductionEnvironment('production')).toBe(true)
    expect(isProductionEnvironment('preview')).toBe(false)
    expect(isProductionEnvironment(null)).toBe(false)
  })
})
