import { describe, expect, it } from 'vitest'
import { renderInvitationEmail } from '../email'

const base = {
  locale: 'it',
  inviterName: 'Anna',
  placeName: 'Studio A',
  role: 'editor',
  extras: [] as string[],
  url: 'https://abluo.app/invite/accept?token=abc&lang=it',
  expiresAt: new Date('2026-10-21T12:00:00Z'),
}

describe('invitation email', () => {
  it('is written in the inviter’s language, with role and place', () => {
    const m = renderInvitationEmail(base)
    expect(m.subject).toBe('Anna ti ha invitato su Studio A')
    expect(m.text).toContain('come Editor')
    expect(m.html).toContain('lang="it"')
    expect(m.html).toContain('href="https://abluo.app/invite/accept?token=abc&amp;lang=it"')
  })
  it('falls back to English for a language without texts', () => {
    expect(renderInvitationEmail({ ...base, locale: 'fr' }).subject).toBe('Anna invited you to Studio A')
  })
  it('escapes names in HTML — a name is never markup', () => {
    const m = renderInvitationEmail({ ...base, inviterName: '<script>x</script>', placeName: 'A & "B"' })
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
    expect(m.html).toContain('A &amp; &quot;B&quot;')
  })
  it('lists the extras in words', () => {
    expect(renderInvitationEmail({ ...base, locale: 'en', extras: ['forms.submission.read'] }).text).toContain('contact requests')
  })
})
