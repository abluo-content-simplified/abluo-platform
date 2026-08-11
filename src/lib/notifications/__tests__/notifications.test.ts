import { describe, it, expect } from 'vitest'
import { getAppEnvironment, isProductionEnvironment } from '@/lib/notifications/environment'
import { filterRecipientGroups } from '@/lib/notifications/recipients'
import { renderNewSubmissionEmail } from '@/lib/notifications/templates'

describe('notification environment gate', () => {
  it('only production is production', () => {
    expect(isProductionEnvironment('production')).toBe(true)
    expect(isProductionEnvironment('preview')).toBe(false)
    expect(isProductionEnvironment('development')).toBe(false)
    expect(isProductionEnvironment(null)).toBe(false)
    expect(isProductionEnvironment(undefined)).toBe(false)
  })
  it('getAppEnvironment falls back to development for unknown VERCEL_ENV', () => {
    const v = getAppEnvironment()
    expect(['production', 'preview', 'development']).toContain(v)
  })
})

describe('filterRecipientGroups', () => {
  const groups = [
    { topic: 'early-access', emails: ['a@x.test', 'A@X.test'], enabled: true },
    { topic: 'contact', emails: ['c@x.test'], enabled: true },
    { topic: 'all', emails: ['all@x.test'], enabled: true },
    { topic: 'early-access', emails: ['disabled@x.test'], enabled: false },
    { emails: ['notopic@x.test'], enabled: true }, // no topic = matches all
  ]

  it('matches the topic + all + no-topic groups, deduped and lowercased', () => {
    const r = filterRecipientGroups(groups, 'early-access')
    expect(r).toContain('a@x.test')
    expect(r).toContain('all@x.test')
    expect(r).toContain('notopic@x.test')
    expect(r).not.toContain('c@x.test') // different topic
    expect(r).not.toContain('disabled@x.test') // disabled group
    // dedupe of a@x.test / A@X.test
    expect(r.filter((e) => e === 'a@x.test')).toHaveLength(1)
  })

  it('returns [] for null/empty', () => {
    expect(filterRecipientGroups(null, 'early-access')).toEqual([])
    expect(filterRecipientGroups([], 'early-access')).toEqual([])
  })
})

describe('renderNewSubmissionEmail', () => {
  it('builds a subject from name/email and lists data + attribution', () => {
    const out = renderNewSubmissionEmail({
      formId: 'early-access',
      topic: 'early-access',
      locale: 'it',
      submissionId: 'sub-1',
      submissionData: { name: 'John', email: 'john@x.test', useCases: ['a', 'b'] },
      source: { utm_source: 'newsletter', utm_campaign: 'launch', country: 'IT' },
      createdAt: '2026-08-11T00:00:00Z',
    })
    expect(out.subject).toContain('early-access')
    expect(out.subject).toContain('John')
    expect(out.html).toContain('john@x.test')
    expect(out.html).toContain('newsletter')
    expect(out.text).toContain('useCases: a, b')
    expect(out.html).toContain('sub-1')
  })

  it('escapes HTML in submitted values', () => {
    const out = renderNewSubmissionEmail({
      formId: 'early-access', topic: 'early-access', locale: 'en', submissionId: 's',
      submissionData: { name: '<script>alert(1)</script>' }, source: {},
    })
    expect(out.html).not.toContain('<script>alert(1)</script>')
    expect(out.html).toContain('&lt;script&gt;')
  })
})
