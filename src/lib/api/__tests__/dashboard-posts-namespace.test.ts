/**
 * The client dashboard's Posts list is NOT empty for Livener.
 *
 * ── The defect this file exists to prevent ──────────────────────────────────
 * `ProjectGrant.projectSlug` is read straight off Supabase `projects.slug`
 * (`tenant-context.ts`, branded `asSupabaseProjectSlug`). Sanity documents
 * carry their OWN `projectSlug` field, and for two live projects the two
 * stores disagree: the grant says `livener`, every one of the 24 Livener
 * documents says `livener-main` (`src/lib/tenancy/RENAME.md` §0).
 *
 * `tenantScopedSanityClient` binds the grant's value into the GROQ scope. With
 * the old `projectSlug == $projectSlug` filter that value matched NO document,
 * so `dashboardPostsQuery` returned an empty array and
 * `[locale]/(client)/[tenant]/posts/page.tsx` rendered an empty Posts list for
 * a client who has seven published posts. It was invisible for
 * abluo / nologo / hoffmann / amelie, whose two names coincide — which is
 * exactly why it survived review.
 *
 * The fix is the step-3 DUAL-READ: queries filter `projectSlug in
 * $projectSlugs`, and the chokepoint binds every name the project is known by.
 *
 * ── How this test works ─────────────────────────────────────────────────────
 * The injected fetch is a MINIMAL GROQ evaluator over a fixture dataset: it
 * reads the scope predicate out of the query text and applies the params it
 * was actually handed. That is the point — it fails if EITHER half regresses
 * (the query going back to a single name, or the chokepoint dropping the
 * array), and it fails the way production failed, with an empty list, rather
 * than on a params snapshot that could be "fixed" by updating the snapshot.
 *
 * After step 4 renames the documents this file keeps passing unchanged: swap
 * the fixture's `livener-main` for `livener` and it still passes, which is the
 * whole property dual-read buys.
 */
import { describe, it, expect, vi } from 'vitest'
import { getDashboardPosts } from '../client-dashboard'
import {
  assertSameTenantReference,
  TenantAuthorizationError,
  tenantScopedSanityClient,
} from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

/** What Sanity actually holds today — the `-main` names, un-migrated. */
const DATASET = [
  { _id: 'post-liv-1', _type: 'post', projectSlug: 'livener-main', title: 'Livener one' },
  { _id: 'post-liv-2', _type: 'post', projectSlug: 'livener-main', title: 'Livener two' },
  { _id: 'post-sm-1', _type: 'post', projectSlug: 'studiomartegani-main', title: 'Martegani one' },
  { _id: 'post-nologo-1', _type: 'post', projectSlug: 'nologo', title: 'No!Logo one' },
]

/**
 * A deliberately tiny GROQ stand-in: it honours ONLY the project-scope
 * predicate, read out of the query text, against the params the chokepoint
 * bound. An unscoped query throws rather than returning everything.
 */
function fakeSanity(dataset = DATASET) {
  return vi.fn(async (query: string, params: Record<string, unknown> = {}) => {
    let matches: (doc: (typeof DATASET)[number]) => boolean
    if (query.includes('projectSlug in $projectSlugs')) {
      const slugs = params.projectSlugs
      if (!Array.isArray(slugs)) {
        throw new Error('query filters on $projectSlugs but the caller bound no array')
      }
      matches = (doc) => slugs.includes(doc.projectSlug)
    } else if (query.includes('projectSlug == $projectSlug')) {
      matches = (doc) => doc.projectSlug === params.projectSlug
    } else {
      throw new Error('unscoped query reached the dataset')
    }
    return dataset.filter((doc) => doc._type === 'post' && matches(doc)) as never
  })
}

/**
 * The REAL grant shape: `projects.slug` for Livener is `livener`. The existing
 * suites use `livener-main` here, which is a Sanity name in a Supabase field —
 * the very conflation that hid this defect. This fixture is deliberately
 * accurate, so the namespaces actually disagree in the test the way they
 * disagree in production.
 */
const livenerGrant: ProjectGrant = {
  projectId: 'project-livener',
  projectSlug: asSupabaseProjectSlug('livener'),
  membershipId: 'pm-owner-livener',
  role: 'owner',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
}

const martiganiGrant: ProjectGrant = {
  projectId: 'project-studiomartegani',
  projectSlug: asSupabaseProjectSlug('studiomartegani'),
  membershipId: 'pm-owner-sm',
  role: 'owner',
  permissions: ['blog.post.read'],
  enabledModuleIds: ['blog'],
}

const ctx = (grants: ProjectGrant[]): TenantAuthorizationContext => ({
  userId: 'user-1',
  platformRole: 'tenant_user',
  projects: grants,
})

describe("the client dashboard's Posts list for Livener", () => {
  it('is NOT empty — a Supabase grant slug reaches Sanity `-main` documents', async () => {
    const fetch = fakeSanity()

    const posts = await getDashboardPosts(
      ctx([livenerGrant]),
      'project-livener',
      { locale: 'en' },
      { fetch },
    )

    expect(
      posts.map((p) => (p as unknown as { _id: string })._id),
      'the Posts list is EMPTY for Livener — the dashboard binds Supabase\'s ' +
        '`livener` and the documents carry Sanity\'s `livener-main`. Either the ' +
        'query lost `projectSlug in $projectSlugs` or the chokepoint stopped ' +
        'binding the dual-read array.',
    ).toEqual(['post-liv-1', 'post-liv-2'])
  })

  it('still returns only Livener — the widening is the second NAME, not a second project', async () => {
    const fetch = fakeSanity()
    const posts = await getDashboardPosts(
      ctx([livenerGrant]),
      'project-livener',
      { locale: 'en' },
      { fetch },
    )
    const slugs = posts.map((p) => (p as unknown as { projectSlug: string }).projectSlug)
    expect(slugs.every((s) => s === 'livener-main')).toBe(true)
  })

  it('is non-empty for Studio Martegani too, and does not see Livener', async () => {
    const fetch = fakeSanity()
    const posts = await getDashboardPosts(
      ctx([martiganiGrant]),
      'project-studiomartegani',
      { locale: 'en' },
      { fetch },
    )
    expect(posts.map((p) => (p as unknown as { _id: string })._id)).toEqual(['post-sm-1'])
  })

  it('is unaffected for a project whose two names already agree', async () => {
    // The masking case. `nologo` is one name in both stores, so its dual-read
    // array has one element and the filter is the equality filter it replaced.
    const nologoGrant: ProjectGrant = {
      ...livenerGrant,
      projectId: 'project-nologo',
      projectSlug: asSupabaseProjectSlug('nologo'),
    }
    const fetch = fakeSanity()
    const posts = await getDashboardPosts(
      ctx([nologoGrant]),
      'project-nologo',
      { locale: 'en' },
      { fetch },
    )
    expect(posts.map((p) => (p as unknown as { _id: string })._id)).toEqual(['post-nologo-1'])
  })
})

// ── assertSameTenantReference: fixed WITHOUT weakening the guard ─────────────
//
// The same conflation, in its most dangerous form: this compared a SANITY slug
// (read off the referenced document) against a SUPABASE slug (the grant), so
// `'livener-main' !== 'livener'` rejected EVERY legitimate reference. Harmless
// only because it has no callers yet — a landmine for whoever wires it first.
//
// The half that matters is the second one: the accepted set is the dual-read
// set for the GRANTED project and nothing else, so a genuine cross-tenant
// reference is still rejected.

describe('assertSameTenantReference', () => {
  const referenceTo = (projectSlug: string | null) =>
    vi.fn(async () => (projectSlug === null ? null : { projectSlug })) as never

  it('ACCEPTS a reference to a document of the same project under its Sanity name', async () => {
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('livener-main'),
    })
    await expect(
      assertSameTenantReference(scoped, 'post-liv-1', livenerGrant),
    ).resolves.toBeUndefined()
  })

  it('ACCEPTS the same document after the step-4 rename, under its Supabase name', async () => {
    // Both states of the migration are legal for as long as dual-read stands.
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('livener'),
    })
    await expect(
      assertSameTenantReference(scoped, 'post-liv-1', livenerGrant),
    ).resolves.toBeUndefined()
  })

  it('REJECTS a genuine cross-tenant reference', async () => {
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('studiomartegani-main'),
    })
    await expect(
      assertSameTenantReference(scoped, 'post-sm-1', livenerGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it('REJECTS a sibling project of the SAME tenant that the grant does not cover', async () => {
    // `livener-events` shares a prefix with the granted project and is owned by
    // the same tenant. A suffix-stripping or prefix-matching "fix" would let it
    // through; a lookup against the alias table does not.
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('livener-events'),
    })
    await expect(
      assertSameTenantReference(scoped, 'evt-1', livenerGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it('REJECTS a document that carries no projectSlug at all', async () => {
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo(null),
    })
    await expect(
      assertSameTenantReference(scoped, 'orphan', livenerGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it('REJECTS when the grant passed in is for another project than the client', async () => {
    // The grant is read EXPLICITLY, never re-derived from the client — a real
    // grant for the wrong project must not authorize this reference.
    const scoped = tenantScopedSanityClient(
      ctx([livenerGrant, martiganiGrant]),
      'project-livener',
      { fetch: referenceTo('livener-main') },
    )
    await expect(
      assertSameTenantReference(scoped, 'post-liv-1', martiganiGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })
})
