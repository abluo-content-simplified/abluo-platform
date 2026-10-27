/** Privacy line above the submit button — instead of a consent checkbox. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormDefinitionRenderer } from '@/components/forms/FormDefinitionRenderer'
import { splitNoticeLink, privacyPageHref } from '@/lib/forms/privacy-notice'
import { mapSanityFormDefinition } from '@/lib/forms/definition-source'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'
import type { RenderableFormDefinition } from '@/lib/sanity/types'

describe('splitNoticeLink', () => {
  it('splits around the {braced} link text', () => {
    expect(splitNoticeLink('By sending, you agree to our {privacy policy}.')).toEqual({ before: 'By sending, you agree to our ', link: 'privacy policy', after: '.' })
  })
  it('without braces (or with malformed ones) is plain text, braces removed', () => {
    expect(splitNoticeLink('Plain line.')).toEqual({ before: 'Plain line.', link: null, after: '' })
    expect(splitNoticeLink('a {b} c {d}')).toEqual({ before: 'a b c d', link: null, after: '' })
  })
})

describe('privacyPageHref', () => {
  it('builds the site path in the request locale, host-scoped or not', () => {
    expect(privacyPageHref('confidentialite', 'fr', 'cyce', false)).toBe('/fr/cyce/confidentialite')
    expect(privacyPageHref('/privacy/', 'en', 'tmz', true)).toBe('/en/privacy')
  })
  it('is null without a slug', () => {
    expect(privacyPageHref(null, 'en', 'tmz', false)).toBeNull()
    expect(privacyPageHref('  ', 'en', 'tmz', false)).toBeNull()
  })
})

const def = (extra: Partial<RenderableFormDefinition> = {}): RenderableFormDefinition => ({
  _id: 'f', formId: 'book-recommendation', formType: 'single-step',
  steps: [{ key: 'book', fields: [{ id: 'book_title', type: 'text', required: true, label: 'Book title' }] }] as never,
  ...extra,
})
const render = (d: RenderableFormDefinition, locale = 'en') =>
  renderToStaticMarkup(<FormDefinitionRenderer definition={d} messages={getFormSectionMessages(locale)} locale={locale} tenantSlug={'cyce' as never} />)

describe('FormDefinitionRenderer — privacy line', () => {
  it('shows the line with a working link and no consent checkbox', () => {
    const html = render(def({ requireConsent: false, privacyNotice: 'En envoyant, vous acceptez notre {politique de confidentialité}.', privacyPageSlug: 'confidentialite' }), 'fr')
    expect(html).toContain('data-form-privacy-notice')
    expect(html).toMatch(/<a href="\/fr\/cyce\/confidentialite"[^>]*>politique de confidentialité<\/a>\./)
    expect(html).not.toContain('gdpr_consent')
    expect(html.indexOf('data-form-privacy-notice')).toBeLessThan(html.indexOf('type="submit"'))
  })
  it('without a page the words stay plain text', () => {
    const html = render(def({ privacyNotice: 'By sending, you agree to our {privacy policy}.' }))
    expect(html).toContain('By sending, you agree to our privacy policy.')
    expect(html).not.toContain('<a href')
  })
  it('a form without a line renders as before', () => {
    expect(render(def({ requireConsent: true, consentText: 'I agree.' }))).not.toContain('data-form-privacy-notice')
  })
})

describe('server side — no checkbox, no consent requirement', () => {
  it('a definition without requireConsent does not require consent at submit', () => {
    const d = mapSanityFormDefinition({ formId: 'book-recommendation', version: 3, requiresConsent: false, steps: [{ key: 'book', fields: [{ internalKey: 'book_title', type: 'text', required: true }] }] })
    expect(d?.requiresConsentAtFinalStep).toBe(false)
  })
})
