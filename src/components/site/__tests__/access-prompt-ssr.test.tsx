/**
 * ADR-040 B2.3 — the members-only placeholder and password prompt as the
 * SERVER sends them: a working form without JavaScript, accessible labels and
 * live regions, every language, and nothing about the page.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MembersBar, RestrictedPage, type RestrictedPageProps } from '@/components/site/RestrictedPage'
import { ACCESS_FORM_FIELDS, accessFormActions } from '@/lib/access/request'
import { promptNotice, promptNoticeKind } from '@/lib/access/prompt'
import { ACCESS_MESSAGES_FOR_TEST, getAccessMessages } from '@/lib/i18n/access-messages'

const base = (over: Partial<RestrictedPageProps> = {}): RestrictedPageProps => ({
  locale: 'en',
  homeHref: '/en/site',
  actions: accessFormActions('/en/site'),
  returnTo: '/en/site/members',
  fields: ACCESS_FORM_FIELDS,
  notice: null,
  signedIn: false,
  ...over,
})
const render = (p: RestrictedPageProps) => renderToStaticMarkup(<RestrictedPage {...p} />)

describe('the password prompt (server HTML)', () => {
  const html = render(base())
  it('is a plain POST form to the unlock route, with the return path', () => {
    const form = /<form[^>]*>/.exec(html)![0]
    expect(form).toContain('method="post"')
    expect(form).toContain('action="/en/site/site-access/unlock"')
    expect(html).toContain('<input type="hidden" name="returnTo" value="/en/site/members"/>')
  })
  it('has a labelled, required password field that password managers recognise', () => {
    const input = /<input[^>]*name="password"[^>]*>/.exec(html)![0]
    expect(input).toMatch(/type="password"/)
    expect(input).toMatch(/required=""/)
    expect(input).toMatch(/autoComplete="current-password"|autocomplete="current-password"/i)
    const id = /id="([^"]+)"/.exec(input)![1]
    expect(html).toContain(`<label for="${id}"`)
    expect(html).toMatch(/<button type="submit"[^>]*>Continue<\/button>/)
  })
  it('offers a way home and no sign-out unless signed in', () => {
    expect(html).toContain('href="/en/site"')
    expect(html).not.toContain('site-access/sign-out')
    expect(render(base({ signedIn: true }))).toMatch(/action="\/en\/site\/site-access\/sign-out"/)
  })
  it('on the project\'s own domain the actions have no project segment', () => {
    expect(accessFormActions('/it')).toEqual({ unlock: '/it/site-access/unlock', signOut: '/it/site-access/sign-out' })
  })
})

describe('notices', () => {
  const m = getAccessMessages('en')
  it('an error is announced as an alert and tied to the field', () => {
    const n = promptNotice('wrong', m, null)!
    const html = render(base({ notice: n }))
    expect(html).toMatch(/<p id="([^"]+)" role="alert"[^>]*>That password didn’t work/)
    const noticeId = /<p id="([^"]+)" role="alert"/.exec(html)![1]
    expect(html).toContain(`aria-describedby="${noticeId}"`)
    expect(html).toContain('aria-invalid="true"')
  })
  it('information (signed out, access ended) is a polite status, not an error', () => {
    expect(render(base({ notice: promptNotice('signed_out', m, null) }))).toMatch(/role="status"[^>]*>You’ve been signed out/)
    expect(render(base({ notice: promptNotice('ended', m, null) }))).not.toContain('aria-invalid')
    // a wait or an outage is an error message, but the typed password is not marked invalid
    expect(render(base({ notice: promptNotice('wait', m, 5) }))).toMatch(/role="alert"/)
    expect(render(base({ notice: promptNotice('wait', m, 5) }))).not.toContain('aria-invalid')
  })
  it('the wait message carries the minutes and nothing else', () => {
    expect(promptNotice('wait', m, 7)!.text).toBe(`${m.tooManyAttempts} You can try again in about 7 min.`)
    expect(promptNotice('wait', m, null)!.text).toBe(m.tooManyAttempts)
  })
  it('the route outcome wins over the gate; otherwise the gate speaks about the visitor only', () => {
    const denied = (visitor: 'none' | 'ended' | 'other_groups') => ({ kind: 'denied' as const, reason: 'no_session' as const, navigation: 'hidden' as const, visitor })
    expect(promptNoticeKind('wrong', denied('ended'))).toBe('wrong')
    expect(promptNoticeKind(null, denied('ended'))).toBe('ended')
    expect(promptNoticeKind(null, denied('other_groups'))).toBe('other_groups')
    expect(promptNoticeKind(null, denied('none'))).toBeNull()
  })
  it('every notice exists in all seven languages, and the {minutes} placeholder survives translation', () => {
    for (const [code, msgs] of Object.entries(ACCESS_MESSAGES_FOR_TEST)) {
      for (const kind of ['wrong', 'wait', 'unavailable', 'signed_out', 'signed_out_browser', 'ended', 'other_groups'] as const) {
        expect(promptNotice(kind, msgs, 3)?.text.trim(), `${code}.${kind}`).toBeTruthy()
      }
      expect(msgs.tryAgainIn, code).toContain('{minutes}')
      expect(promptNotice('wait', msgs, 3)!.text, code).toContain('3')
    }
  })
  it('renders in every language without falling back to English', () => {
    for (const code of Object.keys(ACCESS_MESSAGES_FOR_TEST).filter((c) => c !== 'en')) {
      const html = render(base({ locale: code }))
      expect(html, code).toContain(ACCESS_MESSAGES_FOR_TEST[code].passwordLabel)
      expect(html, code).toContain(ACCESS_MESSAGES_FOR_TEST[code].submit)
    }
  })
})

describe('the members strip on a page the visitor may see', () => {
  it('is a sign-out form back to the same page', () => {
    const html = renderToStaticMarkup(<MembersBar locale="de" signOutAction="/de/site/site-access/sign-out" returnTo="/de/site/members" fields={ACCESS_FORM_FIELDS} />)
    const form = /<form[^>]*>/.exec(html)![0]
    expect(form).toContain('method="post"')
    expect(form).toContain('action="/de/site/site-access/sign-out"')
    expect(html).toContain('Mitgliederbereich')
    expect(html).toMatch(/<button type="submit"[^>]*>Abmelden<\/button>/)
  })
})
