import { describe, it, expect } from 'vitest'
import { renderSubject, DEFAULT_SUBJECT_TEMPLATE, renderNewSubmissionEmail } from '@/lib/notifications/templates'
import { resolveFromName, safeReplyTo } from '@/lib/notifications/branding'

describe('renderSubject', () => {
  it('uses the default template when none is configured', () => {
    expect(renderSubject(undefined, { topic: 'contact', who: 'John', formId: 'contact' }))
      .toBe('New contact submission — John')
    expect(DEFAULT_SUBJECT_TEMPLATE).toContain('{topic}')
  })
  it('interpolates {topic}/{who}/{formId} in a custom template', () => {
    expect(renderSubject('[{formId}] {who} asked about {topic}', { topic: 'pricing', who: 'Ada', formId: 'contact' }))
      .toBe('[contact] Ada asked about pricing')
  })
})

describe('resolveFromName', () => {
  it('prefers explicit config, then client name, then undefined', () => {
    expect(resolveFromName('Livener', 'Client X')).toBe('Livener')
    expect(resolveFromName('  ', 'Client X')).toBe('Client X')
    expect(resolveFromName(undefined, undefined)).toBeUndefined()
  })
})

describe('safeReplyTo', () => {
  it('accepts a normal email', () => {
    expect(safeReplyTo('lead@example.com')).toBe('lead@example.com')
  })
  it('rejects non-emails and header-injection attempts', () => {
    expect(safeReplyTo('not-an-email')).toBeUndefined()
    expect(safeReplyTo('a@b.c\nBcc: evil@x.test')).toBeUndefined()
    expect(safeReplyTo('a@b.c, c@d.e')).toBeUndefined()
    expect(safeReplyTo(42)).toBeUndefined()
  })
})

describe('renderNewSubmissionEmail — personalization', () => {
  const base = {
    formId: 'contact', topic: 'contact', locale: 'en', submissionId: 's1',
    submissionData: { name: 'John', email: 'john@x.test' }, source: {},
  }
  it('applies fromName, intro, and a custom subject', () => {
    const out = renderNewSubmissionEmail({
      ...base, fromName: 'Livener', intro: 'You have a new lead.', subjectTemplate: '{who} — new {topic}',
    })
    expect(out.subject).toBe('John — new contact')
    expect(out.html).toContain('Livener')
    expect(out.html).toContain('You have a new lead.')
    expect(out.text).toContain('Livener')
    expect(out.text).toContain('You have a new lead.')
  })
  it('escapes fromName/intro in HTML', () => {
    const out = renderNewSubmissionEmail({ ...base, fromName: '<b>x</b>', intro: '<i>hi</i>' })
    expect(out.html).not.toContain('<b>x</b>')
    expect(out.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
  it('falls back to the generic sentence when no personalization is set', () => {
    const out = renderNewSubmissionEmail(base)
    expect(out.subject).toBe('New contact submission — John')
    expect(out.html).toContain('A visitor completed and submitted the form')
  })
})
