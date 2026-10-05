import { describe, it, expect } from 'vitest'
import { postBySlugQuery } from '@/lib/sanity/queries'
import { postDraftPreviewQuery, __derive } from '@/lib/sanity/post-preview-query'

describe('postDraftPreviewQuery', () => {
  it('uses exactly the live projection', () => {
    const live = postBySlugQuery.slice(postBySlugQuery.indexOf('][0]'))
    expect(postDraftPreviewQuery.endsWith(live)).toBe(true)
  })

  it('filters by project and the draft id only — no slug, no publish window', () => {
    const filter = postDraftPreviewQuery.slice(0, postDraftPreviewQuery.indexOf('][0]'))
    expect(filter).toBe('*[_type == "post" && projectSlug == $projectSlug && _id == $draftId')
    expect(filter).not.toContain('publishedAt')
  })

  it('fails loudly if the live query changes shape', () => {
    expect(() => __derive('*[_type == "page"][0]{x}')).toThrow()
    expect(() => __derive('*[_type == "post"]{x}')).toThrow()
  })
})
