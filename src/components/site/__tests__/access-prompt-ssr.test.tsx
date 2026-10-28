/**
 * ADR-040 B2.3 — the members-only placeholder and password prompt as the
 * SERVER sends them: a working form without JavaScript, accessible labels and
 * live regions, every language, and nothing about the page.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MembersBar, RestrictedPage, type RestrictedPageProps } from '@/components/site/RestrictedPage'
import { MembersStatusBarView } from '@/components/site/MembersStatusBar'
import { hasPromptNote } from '@/components/site/AccessPromptNote'
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

describe('the members status bar under the header (R9)', () => {
  const html = renderToStaticMarkup(
    <MembersStatusBarView signOutAction="/fr/site/site-access/sign-out" returnField="returnTo" returnTo="/fr/site/horaires" labels={{ membersArea: 'Espace membres', signOut: 'Se déconnecter' }} />
  )
  it('sits on the accent with the primary-button text colour (the pair every primary button uses)', () => {
    const bar = /<div[^>]*data-access="members-status"[^>]*>/.exec(html)![0]
    expect(bar).toContain('background:var(--btn-primary-bg, var(--color-primary))')
    expect(bar).toContain('color:var(--btn-primary-text, var(--color-background))')
    expect(html).not.toMatch(/surface-2|text-muted/)
  })
  it('stays a right-aligned row that may wrap on phones', () => {
    const form = /<form[^>]*>/.exec(html)![0]
    expect(form).toMatch(/justify-end/)
    expect(form).toMatch(/flex-wrap/)
    expect(form).toContain('method="post"')
    expect(form).toContain('action="/fr/site/site-access/sign-out"')
    expect(html).toContain('<input type="hidden" name="returnTo" value="/fr/site/horaires"/>')
  })
  it('the sign-out is an underlined button with a visible focus ring in the bar\'s own text colour', () => {
    const btn = /<button[^>]*>Se déconnecter<\/button>/.exec(html)![0]
    expect(btn).toContain('type="submit"')
    expect(btn).toMatch(/\bunderline\b/)
    expect(btn).toMatch(/focus-visible:outline-2/)
    expect(btn).toContain('outline-color:currentColor')
    expect(btn).toContain('color:inherit')
    expect(html).toContain('Espace membres')
  })
})

describe('the note under the sign-in (R9)', () => {
  const link = (href: string, blank?: boolean) => ({ _type: 'link', _key: 'l', href, ...(blank === undefined ? {} : { blank }) })
  const note = (text: string, extra: Record<string, unknown> = {}) => [{
    _type: 'block', _key: 'b', style: 'normal', markDefs: [link('https://webgate.ec.europa.eu/where2go/fit/activity/566909', true)],
    children: [
      { _type: 'span', _key: 's1', text, marks: [] },
      { _type: 'span', _key: 's2', text: 'Where2go', marks: ['l'] },
      { _type: 'span', _key: 's3', text: '.', marks: ['strong'] },
    ],
    ...extra,
  }]
  it('without a note the page is byte-identical, whatever "empty" looks like', () => {
    const plain = render(base())
    expect(plain).not.toContain('prompt-note')
    for (const n of [null, undefined, [], [{ _type: 'block', _key: 'e', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's', text: '  ', marks: [] }] }]]) {
      expect(render(base({ note: n as never }))).toBe(plain)
    }
  })
  it('renders after the go-home link as muted small text, with a safe new-tab external link and bold', () => {
    const html = render(base({ note: note('To get an idea of our current offer, see ') }))
    const at = html.indexOf('data-access="prompt-note"')
    expect(at).toBeGreaterThan(html.indexOf('href="/en/site"'))
    const box = /<div[^>]*data-access="prompt-note"[^>]*>/.exec(html)![0]
    expect(box).toMatch(/text-sm/)
    expect(box).toContain('color:var(--color-text-muted, var(--color-text-secondary))')
    expect(html).toMatch(/<a href="https:\/\/webgate\.ec\.europa\.eu\/where2go\/fit\/activity\/566909" target="_blank" rel="noopener noreferrer"[^>]*>Where2go<\/a>/)
    expect(html).toContain('To get an idea of our current offer, see ')
    expect(html).toMatch(/<strong[^>]*>\.<\/strong>/)
  })
  it('keeps typed line breaks, and an unsafe href is plain text', () => {
    const html = render(base({ note: [{ _type: 'block', _key: 'b', style: 'normal', markDefs: [link('javascript:alert(1)')],
      children: [{ _type: 'span', _key: 's1', text: 'Line one\nLine two ', marks: [] }, { _type: 'span', _key: 's2', text: 'click', marks: ['l'] }] }] }))
    expect(html).toMatch(/Line one<br\/>Line two/)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('click')
  })
  it('a heading or list that slipped into stored data renders as a paragraph', () => {
    const html = render(base({ note: note('x', { style: 'h2' }) }))
    expect(html).not.toMatch(/<h2/)
    expect(hasPromptNote([{ _type: 'image' }])).toBe(false)
  })
})
