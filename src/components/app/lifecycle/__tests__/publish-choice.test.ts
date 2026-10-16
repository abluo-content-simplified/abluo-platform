import { describe, expect, it } from 'vitest'
import { publishChoiceDates } from '../PublishChoice'

describe('publishChoiceDates — only the dates the choice uses are sent', () => {
  const at = '2026-11-01T08:00:00.000Z'
  const end = '2026-12-01T08:00:00.000Z'
  it('publish now: no publish date, the unpublish date only when switched on', () => {
    expect(publishChoiceDates({ mode: 'now', publishAt: at, expire: false, unpublishAt: end })).toEqual({ publishAt: null, expiresAt: null })
    expect(publishChoiceDates({ mode: 'now', publishAt: at, expire: true, unpublishAt: end })).toEqual({ publishAt: null, expiresAt: end })
  })
  it('schedule: both dates', () => {
    expect(publishChoiceDates({ mode: 'schedule', publishAt: at, expire: true, unpublishAt: end })).toEqual({ publishAt: at, expiresAt: end })
  })
  it('keep as draft: none, whatever was typed before', () => {
    expect(publishChoiceDates({ mode: 'draft', publishAt: at, expire: true, unpublishAt: end })).toEqual({ publishAt: null, expiresAt: null })
  })
})
