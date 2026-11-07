import { describe, it, expect } from 'vitest'
import { invalidEmails, isLocaleKey, isRevisionConflict, notificationsPatchPlan, newRecipientGroup, parseEmails, toForm, toStored } from '../studio/notifications-form'

describe('notifications-form', () => {
  it('applies schema defaults', () => {
    const f = toForm(undefined)
    expect(f.recipients).toEqual([])
    expect(f.internalEmail.replyToSubmitter).toBe(true)
    expect(newRecipientGroup()).toMatchObject({ topic: 'all', enabled: true, emails: [] })
  })

  it('parses and de-duplicates emails', () => {
    expect(parseEmails('a@x.com, b@y.com;\nA@X.com  c@z.it')).toEqual(['a@x.com', 'b@y.com', 'c@z.it'])
    expect(invalidEmails(['a@x.com', 'nope'])).toEqual(['nope'])
  })

  it('round-trips stored data and keeps unknown keys', () => {
    const stored = {
      recipients: [{ _key: 'r1', topic: 'early-access', emails: ['a@x.com'], enabled: false }],
      internalEmail: { fromName: 'Livener', intro: { en: 'Hi', translationStatus: { it: 'stale' } }, replyToSubmitter: false },
    }
    const out = toStored(toForm(stored), stored) as any
    expect(out.recipients).toEqual([{ _key: 'r1', topic: 'early-access', emails: ['a@x.com'], enabled: false }])
    expect(out.internalEmail.fromName).toBe('Livener')
    expect(out.internalEmail.replyToSubmitter).toBe(false)
    expect(out.internalEmail.intro).toEqual({ _type: 'localizedText', en: 'Hi', translationStatus: { it: 'stale' } })
  })

  it('drops empty strings, blank topic becomes "all", cleared intro is removed', () => {
    const stored = { internalEmail: { fromName: 'X', subjectTemplate: 'S', intro: { en: 'Hi' } } }
    const f = toForm(stored)
    f.internalEmail.fromName = ' '
    f.internalEmail.subjectTemplate = ''
    f.internalEmail.intro.en = ''
    f.recipients.push({ ...newRecipientGroup(), topic: ' ', emails: ['a@x.com'] })
    const out = toStored(f, stored) as any
    expect(out.internalEmail).toEqual({ replyToSubmitter: true })
    expect(out.recipients[0].topic).toBe('all')
  })

  it('keeps unknown keys on recipient objects', () => {
    const stored = { recipients: [{ _key: 'r1', topic: 'a', emails: ['a@x.com'], enabled: true, label: 'Front desk' }] }
    const out = toStored(toForm(stored), stored) as any
    expect(out.recipients[0]).toMatchObject({ _key: 'r1', label: 'Front desk' })
  })

  it('ignores _type and non-locale keys in the intro list and the empty check; keeps _type on save', () => {
    const stored = { internalEmail: { intro: { _type: 'localizedText', translationStatus: { it: 'stale' }, en: 'Hi', 'pt-BR': 'Oi' } } }
    const f = toForm(stored)
    expect(Object.keys(f.internalEmail.intro).sort()).toEqual(['en', 'pt-BR'])
    expect((toStored(f, stored) as any).internalEmail.intro).toMatchObject({ _type: 'localizedText', en: 'Hi', translationStatus: { it: 'stale' } })
    // only metadata left = intro is empty and removed
    f.internalEmail.intro = { en: '', 'pt-BR': '' }
    expect((toStored(f, stored) as any).internalEmail.intro).toBeUndefined()
    expect(isLocaleKey('en') && isLocaleKey('pt-BR')).toBe(true)
    expect(isLocaleKey('_type') || isLocaleKey('translationStatus')).toBe(false)
  })

  it('save plan: revision-checked published patch, plus the same set on an existing draft', () => {
    const next = { recipients: [] }
    expect(notificationsPatchPlan('proj', 'rev1', false, next)).toEqual([{ id: 'proj', ifRevisionId: 'rev1', set: { notifications: next } }])
    const withDraft = notificationsPatchPlan('proj', 'rev1', true, next)
    expect(withDraft).toHaveLength(2)
    expect(withDraft[1]).toEqual({ id: 'drafts.proj', set: { notifications: next } })
  })

  it('recognises a revision conflict', () => {
    expect(isRevisionConflict({ statusCode: 409 })).toBe(true)
    expect(isRevisionConflict(new Error('Document revision ID mismatch'))).toBe(true)
    expect(isRevisionConflict(new Error('network'))).toBe(false)
  })
})
