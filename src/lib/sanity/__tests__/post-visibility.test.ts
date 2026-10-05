import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Q from '../queries'

/**
 * W1 — a post is on the website only while it is live (ADR-025 D5):
 * gone live (`publishedAt <= now()`) and not taken offline (`expiresAt`).
 * Drafts are excluded by the API's published perspective; these checks cover
 * scheduled and expired posts on every website read path.
 */
const LIVE = ['defined(publishedAt)', 'publishedAt <= now()', '(!defined(expiresAt) || expiresAt > now())']

describe('W1 — scheduled and expired posts never reach the website', () => {
  const paths: Record<string, string> = {
    'detail page (postBySlugQuery)': Q.postBySlugQuery,
    'old-slug redirect (postByOldSlugQuery)': Q.postByOldSlugQuery,
    'category page (postsByCategoryQuery)': Q.postsByCategoryQuery,
    'blog listing, newest': Q.blogListingPostsNewestQuery,
    'blog listing, oldest': Q.blogListingPostsOldestQuery,
  }
  for (const [name, query] of Object.entries(paths)) {
    it(name, () => {
      for (const clause of LIVE) expect(query).toContain(clause)
    })
  }

  it('sitemap', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/sitemap.ts'), 'utf8')
    const postQuery = src.split('\n').find((l) => l.includes('_type == "post"')) ?? ''
    for (const clause of LIVE) expect(postQuery).toContain(clause)
  })
})

describe('subtitle stands in for a missing excerpt (ADR-025 D4)', () => {
  it('detail page and listings fall back to the subtitle', () => {
    expect(Q.postBySlugQuery).toMatch(/"excerpt": coalesce\([^\n]*excerpt[^\n]*subtitle/)
    expect(Q.blogListingPostsNewestQuery).toMatch(/"excerpt": coalesce\([^\n]*subtitle/)
  })
})
