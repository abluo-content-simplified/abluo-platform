import { describe, it, expect } from 'vitest'
import { cleanListQuery, initialListQuery, listQueryCookieName, LIST_QUERY_MAX } from '../remembered-list-query'

describe('remembered list filters', () => {
  it('one cookie per list and site, safe characters only', () => {
    expect(listQueryCookieName('posts', 'hoffmann')).toBe('abluo-list-posts-hoffmann')
    expect(listQueryCookieName('faq-sets', 'a.b c')).toBe('abluo-list-faq-sets-a-b-c')
    expect(listQueryCookieName('posts', 'hoffmann')).not.toBe(listQueryCookieName('posts', 'livener'))
  })

  it('the address wins; otherwise the remembered query', () => {
    expect(initialListQuery('when=month', 'when=year')).toBe('when=month')
    expect(initialListQuery('', 'when=year&field=published')).toBe('when=year&field=published')
    expect(initialListQuery('', undefined)).toBe('')
  })

  it('ignores an oversized or empty stored value', () => {
    expect(cleanListQuery('')).toBe('')
    expect(cleanListQuery('q=' + 'x'.repeat(LIST_QUERY_MAX))).toBe('')
    expect(cleanListQuery('range=thisYear')).toBe('range=thisYear')
  })
})
