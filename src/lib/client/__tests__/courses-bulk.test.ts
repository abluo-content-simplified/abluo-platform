import { describe, it, expect } from 'vitest'
import { courseBulkSkip, courseBulkTargets, courseDeleteOp, type BulkCourse } from '../courses-bulk'

const c = (state: BulkCourse['state'], over: Partial<BulkCourse> = {}): BulkCourse => ({ state, isPublished: state === 'published' || state === 'changes' || state === 'scheduled', missingLanguages: [], ...over })

describe('courseBulkSkip', () => {
  it('publish: drafts and pending changes with nothing missing', () => {
    expect(courseBulkSkip(c('draft'), 'publish')).toBeNull()
    expect(courseBulkSkip(c('changes'), 'publish')).toBeNull()
    expect(courseBulkSkip(c('draft', { missingLanguages: ['de'] }), 'publish')).toBe('missing_text')
    expect(courseBulkSkip(c('published'), 'publish')).toBe('published')
    expect(courseBulkSkip(c('scheduled'), 'publish')).toBe('scheduled')
    expect(courseBulkSkip(c('archived'), 'publish')).toBe('archived')
  })
  it('archive: only published courses', () => {
    expect(courseBulkSkip(c('published'), 'archive')).toBeNull()
    expect(courseBulkSkip(c('changes'), 'archive')).toBeNull()
    expect(courseBulkSkip(c('draft'), 'archive')).toBe('not_published')
    expect(courseBulkSkip(c('scheduled'), 'archive')).toBe('scheduled')
    expect(courseBulkSkip(c('archived'), 'archive')).toBe('archived')
  })
  it('restore: only archived courses', () => {
    expect(courseBulkSkip(c('archived'), 'restore')).toBeNull()
    expect(courseBulkSkip(c('draft'), 'restore')).toBe('not_archived')
    expect(courseBulkSkip(c('published'), 'restore')).toBe('not_archived')
  })
  it('delete: a never-published draft or an archived course, nothing else', () => {
    expect(courseBulkSkip(c('draft'), 'delete')).toBeNull()
    expect(courseBulkSkip(c('archived'), 'delete')).toBeNull()
    expect(courseBulkSkip(c('archived', { isPublished: true }), 'delete')).toBeNull()
    for (const state of ['published', 'changes', 'scheduled'] as const) expect(courseBulkSkip(c(state), 'delete')).toBe('has_been_published')
  })
  it('publish includes unpublished courses ("Publish again")', () => {
    expect(courseBulkSkip(c('unpublished', { isPublished: true }), 'publish')).toBeNull()
    expect(courseBulkSkip(c('unpublished', { isPublished: true, missingLanguages: ['it'] }), 'publish')).toBe('missing_text')
  })
  it('unpublish / unpublish on…: courses that are (or will be) on the website', () => {
    for (const op of ['unpublish', 'unpublishOn'] as const) {
      expect(courseBulkSkip(c('published'), op)).toBeNull()
      expect(courseBulkSkip(c('changes'), op)).toBeNull()
      expect(courseBulkSkip(c('scheduled'), op)).toBeNull()
      expect(courseBulkSkip(c('unpublished', { isPublished: true }), op)).toBe('unpublished')
      expect(courseBulkSkip(c('draft'), op)).toBe('not_published')
      expect(courseBulkSkip(c('archived'), op)).toBe('archived')
    }
  })
  it('targets and skipped count', () => {
    const rows = [c('draft'), c('published'), c('archived')]
    const r = courseBulkTargets(rows, 'delete')
    expect(r.targets).toEqual([rows[0], rows[2]])
    expect(r.skipped).toBe(1)
  })
  it('a delete is permanent for archived courses and a draft delete otherwise', () => {
    expect(courseDeleteOp({ state: 'archived' })).toBe('deletePermanently')
    expect(courseDeleteOp({ state: 'draft' })).toBe('deleteDraft')
  })
})
