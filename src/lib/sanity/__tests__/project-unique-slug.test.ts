import { describe, it, expect, vi } from 'vitest'
import { isUniqueInProject, projectUniqueSlugParams, PROJECT_UNIQUE_SLUG_QUERY } from '../fields/project-unique-slug'

describe('project-scoped slug uniqueness', () => {
  it('scopes by type, project and locale, and excludes the document itself (draft + published)', () => {
    expect(projectUniqueSlugParams('home', { _id: 'drafts.page-noemi-home', _type: 'page', projectSlug: 'noemi' }, 'en')).toEqual({
      type: 'page', projectSlug: 'noemi', draftId: 'drafts.page-noemi-home', publishedId: 'page-noemi-home', locale: 'en', slug: 'home',
    })
    expect(PROJECT_UNIQUE_SLUG_QUERY).toContain('projectSlug == $projectSlug')
    expect(PROJECT_UNIQUE_SLUG_QUERY).toContain('slug[$locale].current == $slug')
  })

  it('returns what the query says, and passes when there is no document yet', async () => {
    const fetch = vi.fn().mockResolvedValue(true)
    const ctx = { document: { _id: 'page-1', _type: 'page', projectSlug: 'noemi' }, getClient: () => ({ fetch }) }
    expect(await isUniqueInProject('en')('home', ctx)).toBe(true)
    fetch.mockResolvedValue(false)
    expect(await isUniqueInProject('en')('home', ctx)).toBe(false)
    expect(await isUniqueInProject('en')('home', { getClient: () => ({ fetch }) })).toBe(true)
  })
})
