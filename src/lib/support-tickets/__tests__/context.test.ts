import { describe, expect, it } from 'vitest'
import { buildTicketContext, sanitizeFromPath } from '../context'

describe('sanitizeFromPath (ADR-039 D9)', () => {
  it('keeps dashboard paths of the same project, with or without locale', () => {
    expect(sanitizeFromPath('/martegani/posts/abc', 'martegani')).toBe('/martegani/posts/abc')
    expect(sanitizeFromPath('/it/martegani/posts?x=1#y', 'martegani')).toBe('/it/martegani/posts')
  })
  it('drops other projects, other origins and tricks', () => {
    expect(sanitizeFromPath('/hoffmann/posts', 'martegani')).toBeUndefined()
    expect(sanitizeFromPath('https://evil.test/martegani', 'martegani')).toBeUndefined()
    expect(sanitizeFromPath('//evil.test/martegani', 'martegani')).toBeUndefined()
    expect(sanitizeFromPath('/martegani/../admin', 'martegani')).toBeUndefined()
    expect(sanitizeFromPath('/xx/yy/martegani', 'martegani')).toBeUndefined()
    expect(sanitizeFromPath('/martegani/<script>', 'martegani')).toBeUndefined()
    expect(sanitizeFromPath(42, 'martegani')).toBeUndefined()
  })
})

describe('buildTicketContext', () => {
  it('keeps valid facts and drops malformed ones', () => {
    expect(buildTicketContext({
      from: '/martegani/media', projectSlug: 'martegani', platformVersion: 'v1.0.62', userAgent: 'Mozilla/5.0',
      viewport: '390x844', interfaceLocale: 'it', role: 'editor', relatedTo: 'ABL-000123',
    })).toEqual({ page: '/martegani/media', platformVersion: 'v1.0.62', userAgent: 'Mozilla/5.0', viewport: '390x844', interfaceLocale: 'it', role: 'editor', relatedTo: 'ABL-000123' })
    expect(buildTicketContext({ projectSlug: 'm', viewport: 'big', interfaceLocale: 'italiano', relatedTo: 'x' })).toEqual({})
  })
})
