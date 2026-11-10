import { describe, expect, it } from 'vitest'
import { emailAwareHref } from '../href'
import { resolveCta } from '../cta'

describe('emailAwareHref — a bare email in a button link becomes mailto:', () => {
  it('adds mailto: to a bare email address', () => {
    expect(emailAwareHref('HR-CERCLE-DE-YOGA@ec.europa.eu')).toBe('mailto:HR-CERCLE-DE-YOGA@ec.europa.eu')
    expect(emailAwareHref('  info@example.com ')).toBe('mailto:info@example.com')
  })
  it('leaves everything else unchanged', () => {
    for (const h of ['mailto:a@b.com', 'https://x.com/@user', '/about', '#form', 'tel:+3212', '@handle', 'a@b']) {
      expect(emailAwareHref(h)).toBe(h)
    }
    expect(emailAwareHref(undefined)).toBeUndefined()
    expect(emailAwareHref(null)).toBeNull()
  })
  it('an external-URL CTA typed as an email opens the mail app in place', () => {
    const r = resolveCta({ actionType: 'externalUrl', label: 'Email us', externalUrl: 'info@example.com' } as never)
    expect(r).toMatchObject({ type: 'link', href: 'mailto:info@example.com', external: false })
  })
})
