/**
 * The `[tenant]` URL segment allow-list, and the absence of a translation.
 *
 * WHY THIS TEST EXISTS:
 * The public website route boundary (`(website)/[tenant]/layout.tsx`) must fail
 * closed to `notFound()` for an unknown tenant segment (retired flat routes,
 * typos, dead links falling through to the `[tenant]` dynamic segment) rather
 * than render an empty page with a 200. That guard used to be the null branch
 * of `tryTenantToProjectSlug()`, the non-throwing half of the URL→Sanity
 * translation map. `src/lib/tenancy/RENAME.md` Step 4 renamed the documents and
 * Step 5 deleted the map, so the TRANSLATION is gone — but the fail-closed
 * guard is not, and it is what this file now pins, via `isKnownProjectSegment`.
 * Step 6 then moved that guard to `@/lib/tenancy/host-scope` and derived it
 * from the generated route table; the behaviour it must have is unchanged.
 *
 * The second half is the anti-regression: `tenantClient()` must bind the
 * segment VERBATIM. Any reappearance of a `-main` suffix (a map, a
 * `.replace()`, a cast) is the defect this whole workstream removed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tenantClient } from '@/lib/sanity/client'
import { sanityClient } from '@/lib/sanity/client'
// Step 6 moved the allow-list out of sanity/client.ts: it is now derived from
// the generated route table rather than hand-typed. Same guard, one import
// further away — see `@/lib/tenancy/host-scope`.
import { isKnownProjectSegment } from '@/lib/tenancy/host-scope'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'

describe('isKnownProjectSegment', () => {
  it('accepts every segment this deployment serves', () => {
    // `amelie` joined this list in Step 6: it is an active project in Supabase
    // and was missing from the hand-typed set, so `/en/amelie` used to 404.
    for (const segment of ['livener', 'studiomartegani', 'abluo', 'nologo', 'hoffmann', 'amelie']) {
      expect(isKnownProjectSegment(asUrlProjectSegment(segment))).toBe(true)
    }
  })

  it('rejects (never throws for) an unknown segment — the route 404s on this', () => {
    expect(isKnownProjectSegment(asUrlProjectSegment('leads'))).toBe(false)
    expect(isKnownProjectSegment(asUrlProjectSegment('some-typo'))).toBe(false)
    expect(isKnownProjectSegment(asUrlProjectSegment(''))).toBe(false)
  })

  it('rejects the retired `-main` spellings outright', () => {
    // They were never URL segments — they were Sanity's separate names, and
    // Step 4 deleted them from the dataset too.
    expect(isKnownProjectSegment(asUrlProjectSegment('livener-main'))).toBe(false)
    expect(isKnownProjectSegment(asUrlProjectSegment('studiomartegani-main'))).toBe(false)
  })
})

describe('tenantClient binds the segment verbatim — no translation survives', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(sanityClient, 'fetch')
      .mockResolvedValue(null as never) as ReturnType<typeof vi.spyOn>
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it.each(['livener', 'studiomartegani', 'abluo', 'nologo', 'hoffmann'])(
    '%s is bound to $projectSlug unchanged',
    async (segment) => {
      await tenantClient(asUrlProjectSegment(segment)).fetchForTenant(
        '*[_type == "page" && projectSlug == $projectSlug][0]',
      )
      const params = fetchSpy.mock.calls[0][1] as Record<string, unknown>
      expect(params.projectSlug).toBe(segment)
      expect(String(params.projectSlug)).not.toMatch(/-main$/)
    },
  )

  it('no longer binds the removed dual-read array', async () => {
    await tenantClient(asUrlProjectSegment('livener')).fetchForTenant(
      '*[_type == "page" && projectSlug == $projectSlug][0]',
    )
    const params = fetchSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params).not.toHaveProperty('projectSlugs')
  })
})
