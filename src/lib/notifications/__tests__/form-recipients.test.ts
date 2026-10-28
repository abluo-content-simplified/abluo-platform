/**
 * Form notifications (Settings, 2026-10-28) — the pure rules: email format,
 * per-form limit, duplicates, removing, labels from form titles.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_RECIPIENTS_PER_TOPIC,
  addRecipient,
  humanizeTopic,
  normalizeRecipientEmail,
  removeRecipient,
  topicLabel,
} from '../form-recipients'

describe('normalizeRecipientEmail', () => {
  it('accepts an address, trimmed and lowercased', () => {
    expect(normalizeRecipientEmail('  HR-Cercle-de-Yoga@ec.europa.eu ')).toBe('hr-cercle-de-yoga@ec.europa.eu')
    expect(normalizeRecipientEmail('thomas.zimmermann+cyce@gmail.com')).toBe('thomas.zimmermann+cyce@gmail.com')
  })
  it.each(['', '   ', 'no-at-sign', 'a@b', '@x.it', 'a b@x.it', 'a@x.it, b@x.it', 'a@x.it;b@x.it', '"Bob" <bob@x.it>', 'a@x.it\nBcc: c@y.it', 42, null, undefined])(
    'refuses %j',
    (v) => expect(normalizeRecipientEmail(v)).toBeNull(),
  )
  it('refuses an address longer than 254 characters', () => {
    expect(normalizeRecipientEmail(`${'a'.repeat(250)}@x.it`)).toBeNull()
  })
})

describe('addRecipient', () => {
  it('adds a valid, new address', () => {
    expect(addRecipient(['a@x.it'], 'B@X.it')).toEqual({ ok: true, emails: ['a@x.it', 'b@x.it'], email: 'b@x.it' })
  })
  it('refuses a bad format, a duplicate (any case), and more than the per-form max', () => {
    expect(addRecipient([], 'nope')).toEqual({ ok: false, error: 'invalid_email' })
    expect(addRecipient(['A@x.it'], 'a@X.IT')).toEqual({ ok: false, error: 'duplicate' })
    const full = Array.from({ length: MAX_RECIPIENTS_PER_TOPIC }, (_, i) => `p${i}@x.it`)
    expect(addRecipient(full, 'new@x.it')).toEqual({ ok: false, error: 'too_many' })
    expect(MAX_RECIPIENTS_PER_TOPIC).toBe(5)
  })
})

describe('removeRecipient', () => {
  it('removes every spelling of the address; the last one can go (the page warns)', () => {
    expect(removeRecipient(['a@x.it', 'B@x.it'], 'b@x.it')).toEqual({ ok: true, emails: ['a@x.it'], email: 'b@x.it' })
    expect(removeRecipient(['a@x.it'], 'a@x.it')).toEqual({ ok: true, emails: [], email: 'a@x.it' })
  })
  it('an address not on the list is not_found', () => {
    expect(removeRecipient(['a@x.it'], 'z@x.it')).toEqual({ ok: false, error: 'not_found' })
    expect(removeRecipient(['a@x.it'], '')).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('topicLabel', () => {
  const forms = [
    { formId: 'contact', notificationTopic: null, title: { en: 'Contact us', it: 'Contattaci' } },
    { formId: 'book-form', notificationTopic: 'book-recommendation', title: { fr: 'Recommander un livre' } },
  ]
  it('uses the title of the form sending under the topic (topic = notificationTopic, else formId), in the wanted language', () => {
    expect(topicLabel('contact', forms, ['it'])).toBe('Contattaci')
    expect(topicLabel('contact', forms, ['de'])).toBe('Contact us')
    expect(topicLabel('book-recommendation', forms, ['en'])).toBe('Recommander un livre')
  })
  it('falls back to the topic made readable, and is null for the every-form group', () => {
    expect(topicLabel('early-access', forms, ['en'])).toBe('Early access')
    expect(topicLabel('all', forms, ['en'])).toBeNull()
    expect(topicLabel('', forms, ['en'])).toBeNull()
    expect(humanizeTopic('book_recommendation')).toBe('Book recommendation')
  })
})
