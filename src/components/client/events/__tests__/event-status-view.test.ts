import { describe, expect, it } from 'vitest'
import { eventStatusCounts, matchesEventStatus } from '../event-status-view'

const item = (status: 'draft' | 'scheduled' | 'published' | 'unpublished' | 'archived') => ({ lifecycle: { status } })

describe('event status filter', () => {
  it('All hides archived; Archived shows only archived', () => {
    expect(matchesEventStatus('archived', 'all')).toBe(false)
    expect(matchesEventStatus('published', 'all')).toBe(true)
    expect(matchesEventStatus('archived', 'archived')).toBe(true)
    expect(matchesEventStatus('draft', 'archived')).toBe(false)
  })
  it('counts per status, with All excluding archived', () => {
    const c = eventStatusCounts([item('draft'), item('published'), item('published'), item('archived'), item('scheduled')])
    expect(c).toMatchObject({ all: 4, draft: 1, published: 2, scheduled: 1, unpublished: 0, archived: 1 })
  })
})
