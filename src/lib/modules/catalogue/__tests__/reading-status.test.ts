import { describe, expect, it } from 'vitest'
import { isReadingStatus, shelvesOf } from '../reading-status'
import { cleanBookDetails } from '../dashboard-patch'
import { bookDetailsFromDoc, bookDetailsPatch } from '../dashboard-form'

describe('reading status', () => {
  it('knows the three values only', () => {
    expect(['read', 'reading', 'wantToRead'].every(isReadingStatus)).toBe(true)
    expect(isReadingStatus('unread')).toBe(false)
    expect(isReadingStatus(null)).toBe(false)
  })
  it('shelves: reading, read, want to read, then no status; stored order kept; empty shelves left out', () => {
    const items = [
      { id: 'a', s: 'read' },
      { id: 'b', s: 'wantToRead' },
      { id: 'c', s: null },
      { id: 'd', s: 'read' },
    ] as const
    const shelves = shelvesOf(items, (i) => i.s)
    expect(shelves.map((s) => s.status)).toEqual(['read', 'wantToRead', null])
    expect(shelves[0].items.map((i) => i.id)).toEqual(['a', 'd'])
    expect(shelvesOf([{ s: null }], (i) => i.s)).toEqual([{ status: null, items: [{ s: null }] }])
  })
  it('the dashboard saves it, refuses unknown values, and an empty choice clears it', () => {
    expect(cleanBookDetails({ readingStatus: 'wantToRead' })).toEqual({ readingStatus: 'wantToRead' })
    expect(cleanBookDetails({ author: 'X', readingStatus: '' })).toEqual({ author: 'X' })
    expect(() => cleanBookDetails({ readingStatus: 'maybe' })).toThrow()
    const form = bookDetailsFromDoc({ author: 'Douglas Adams', readingStatus: 'reading' })
    expect(form.readingStatus).toBe('reading')
    expect(bookDetailsPatch(form)).toEqual({ author: 'Douglas Adams', readingStatus: 'reading' })
    expect(bookDetailsPatch({ ...form, readingStatus: '' })).toEqual({ author: 'Douglas Adams' })
  })
})
