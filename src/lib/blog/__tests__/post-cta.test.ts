import { describe, expect, it } from 'vitest'
import {
  ctaActionTarget,
  mailtoHref,
  resolvePostCta,
  telHref,
  validateCtaAction,
  type SiteCallToAction,
} from '../post-cta'

const book: SiteCallToAction = {
  _id: 'cta-book',
  internalName: 'Book a first session',
  isDefault: true,
  heading: { _type: 'localizedString', it: 'Prenota un primo colloquio', de: 'Erstgespräch buchen' } as never,
  text: { it: 'Ti rispondo entro 24 ore.' },
  buttonLabel: { it: 'Scrivimi', de: 'Schreib mir' },
  actionType: 'form',
  form: { formId: 'contact', title: 'Contatto' },
}
const call: SiteCallToAction = {
  _id: 'cta-call',
  heading: { it: 'Chiamami' },
  buttonLabel: { it: 'Chiama' },
  actionType: 'phone',
  phone: '+39 0541 123 456',
}
const site = [book, call]

describe('resolvePostCta', () => {
  it('no choice / mode default → the site default', () => {
    expect(resolvePostCta({}, site, 'it')).toMatchObject({ id: 'cta-book', heading: 'Prenota un primo colloquio', buttonLabel: 'Scrivimi', target: { kind: 'form', formId: 'contact' } })
    expect(resolvePostCta({ cta: { mode: 'default' } }, site, 'it')?.id).toBe('cta-book')
  })
  it('none → nothing', () => {
    expect(resolvePostCta({ cta: { mode: 'none' } }, site, 'it')).toBeNull()
  })
  it('custom → that CTA; an unknown key → nothing', () => {
    expect(resolvePostCta({ cta: { mode: 'custom', ref: { _ref: 'cta-call' } } }, site, 'it')?.target).toEqual({
      kind: 'link',
      href: 'tel:+390541123456',
      internal: false,
      external: false,
    })
    expect(resolvePostCta({ cta: { mode: 'custom', ref: { _ref: 'gone' } } }, site, 'it')).toBeNull()
  })
  it('missing text in the visitor language → nothing (no fallback)', () => {
    expect(resolvePostCta({}, site, 'en')).toBeNull()
    expect(resolvePostCta({ cta: { mode: 'custom', ref: { _ref: 'cta-call' } } }, site, 'de')).toBeNull()
    // German has heading + button: shown, without the Italian text.
    expect(resolvePostCta({}, site, 'de')).toMatchObject({ heading: 'Erstgespräch buchen', text: null })
  })
  it('no default configured, or no CTAs at all → nothing', () => {
    expect(resolvePostCta({}, [call], 'it')).toBeNull()
    expect(resolvePostCta({}, null, 'it')).toBeNull()
  })
})

describe('action targets', () => {
  const base = { _id: 'x', heading: { it: 'h' }, buttonLabel: { it: 'b' } }
  it('page and post → internal paths in the visitor language (slug missing there → null)', () => {
    expect(ctaActionTarget({ ...base, actionType: 'page', pageSlugs: { it: { current: 'contatti' } } }, 'it')).toEqual({ kind: 'link', href: '/contatti', internal: true, external: false })
    expect(ctaActionTarget({ ...base, actionType: 'post', postSlugs: { it: { current: 'ansia' } } }, 'it')).toEqual({ kind: 'link', href: '/blog/ansia', internal: true, external: false })
    expect(ctaActionTarget({ ...base, actionType: 'page', pageSlugs: { it: { current: 'contatti' } } }, 'de')).toBeNull()
    expect(ctaActionTarget({ ...base, actionType: 'page', pageSlugs: null }, 'it')).toBeNull()
  })
  it('WhatsApp → wa.me with the pre-filled text in the visitor language', () => {
    expect(ctaActionTarget({ ...base, actionType: 'whatsapp', whatsappNumber: '+39 333 123 4567', whatsappText: { it: 'Ciao Claudia' } }, 'it')).toEqual({
      kind: 'link',
      href: 'https://wa.me/393331234567?text=Ciao%20Claudia',
      internal: false,
      external: true,
    })
  })
  it('email / url / form; invalid values → null', () => {
    expect(ctaActionTarget({ ...base, actionType: 'email', email: 'studio@example.com' }, 'it')).toMatchObject({ href: 'mailto:studio@example.com' })
    expect(ctaActionTarget({ ...base, actionType: 'externalUrl', externalUrl: 'https://example.com/x' }, 'it')).toMatchObject({ href: 'https://example.com/x', external: true })
    expect(ctaActionTarget({ ...base, actionType: 'externalUrl', externalUrl: 'javascript:alert(1)' }, 'it')).toBeNull()
    expect(ctaActionTarget({ ...base, actionType: 'form', form: null }, 'it')).toBeNull()
    expect(ctaActionTarget({ ...base, actionType: 'whatsapp', whatsappNumber: '123' }, 'it')).toBeNull()
    expect(ctaActionTarget({ ...base, actionType: 'weird' }, 'it')).toBeNull()
  })
  it('tel / mailto helpers', () => {
    expect(telHref('0541 123456')).toBe('tel:0541123456')
    expect(telHref('call me')).toBeNull()
    expect(mailtoHref('not an email')).toBeNull()
  })
})

describe('Studio validation', () => {
  it('each action requires its own target', () => {
    expect(validateCtaAction({ actionType: 'page' })).toMatch(/page/)
    expect(validateCtaAction({ actionType: 'page', pageRef: { _ref: 'p' } })).toBe(true)
    expect(validateCtaAction({ actionType: 'post', postRef: { _ref: 'p' } })).toBe(true)
    expect(validateCtaAction({ actionType: 'form' })).toMatch(/form/)
    expect(validateCtaAction({ actionType: 'phone', phone: 'abc' })).toMatch(/phone/)
    expect(validateCtaAction({ actionType: 'whatsapp', whatsappNumber: '+39 333 1234567' })).toBe(true)
    expect(validateCtaAction({ actionType: 'email', email: 'a@b.it' })).toBe(true)
    expect(validateCtaAction({ actionType: 'externalUrl', externalUrl: 'ftp://x' })).toMatch(/https/)
    expect(validateCtaAction({})).toMatch(/Choose/)
  })
  it('a draft reference resolves to the published CTA', () => {
    expect(resolvePostCta({ cta: { mode: 'custom', ref: { _ref: 'drafts.cta-call' } } }, site, 'it')?.id).toBe('cta-call')
  })
})
