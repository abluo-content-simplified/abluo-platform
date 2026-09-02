/**
 * The client dashboard's Posts list is NOT empty for Livener.
 *
 * ── The defect this file exists to prevent ──────────────────────────────────
 * `ProjectGrant.projectSlug` is read straight off Supabase `projects.slug`
 * (`tenant-context.ts`, branded `asSupabaseProjectSlug`). Sanity documents
 * carry their OWN `projectSlug` field, and for two live projects the two
 * stores used to disagree: the grant said `livener`, every one of the 25
 * Livener documents said `livener-main` (`src/lib/tenancy/RENAME.md` §0).
 *
 * `tenantScopedSanityClient` binds the grant's value into the GROQ scope, so
 * the `projectSlug == $projectSlug` filter matched NO document,
 * `dashboardPostsQuery` returned an empty array, and
 * `[locale]/(client)/[tenant]/posts/page.tsx` rendered an empty Posts list for
 * a client who has seven published posts. It was invisible for
 * abluo / nologo / hoffmann / amelie, whose two names coincide — which is
 * exactly why it survived review.
 *
 * `RENAME.md` Step 4 renamed the documents (the Step 3 dual-read carried the
 * dashboard across that window; Step 5 removed it again), so the equality
 * filter is now correct BY THE DATA. This file is what stops that regressing.
 *
 * ── How this test works ─────────────────────────────────────────────────────
 * The injected fetch is a MINIMAL GROQ evaluator over a fixture dataset: it
 * reads the scope predicate out of the query text and applies the params it
 * was actually handed. That is the point — it fails the way production failed,
 * with an empty list, rather than on a params snapshot that could be "fixed"
 * by updating the snapshot.
 *
 * The fixture carries the POST-STEP-4 names, plus one deliberately stale
 * `livener-main` document that must NOT be returned: if anything ever
 * reintroduces an alias table or a suffix transform, that row starts matching
 * and this file says so.
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

/** What Sanity holds after `RENAME.md` Step 4 — one name per project. */
const DATASET = [
  { _id: 'post-liv-1', _type: 'post', projectSlug: 'livener', title: 'Livener one' },
  { _id: 'post-liv-2', _type: 'post', projectSlug: 'livener', title: 'Livener two' },
  { _id: 'post-sm-1', _type: 'post', projectSlug: 'studiomartegani', title: 'Martegani one' },
  { _id: 'post-nologo-1', _type: 'post', projectSlug: 'nologo', title: 'No!Logo one' },
  // A retired name that no live document carries any more. It is here to FAIL
  // the suite if an alias table or a `-main` suffix transform ever comes back:
  // nothing may make this row visible to the Livener grant.
  { _id: 'post-stale', _type: 'post', projectSlug: 'livener-main', title: 'Stale' },
]

/**
 * A deliberately tiny GROQ stand-in: it honours ONLY the project-scope
 * predicate, read out of the query text, against the params the chokepoint
 * bound. An unscoped query throws rather than returning everything.
 */
function fakeSanity(dataset = DATASET) {
  return vi.fn(async (query: string, params: Record<string, unknown> = {}) => {
    let matches: (doc: (typeof DATASET)[number]) => boolean
    if (query.includes('$projectSlugs')) {
      // The Step 3 dual-read binding was removed by Step 5. A query that still
      // asks for it would be handed nothing and match nothing in production.
      throw new Error('query filters on $projectSlugs, which no chokepoint binds any more')
    } else if (query.includes('projectSlug == $projectSlug')) {
      matches = (doc) => doc.projectSlug === params.projectSlug
    } else {
      throw new Error('unscoped query reached the dataset')
    }
    return dataset.filter((doc) => doc._type === 'post' && matches(doc)) as never
  })
}

/**
 * The REAL grant shape: `projects.slug` for Livener is `livener`, which since
 * Step 4 is also what its Sanity documents carry. Older suites branded
 * `livener-main` here — a Sanity name in a Supabase field, the very conflation
 * that hid this defect.
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
  it('is NOT empty — the grant slug matches the documents\' own projectSlug', async () => {
    const fetch = fakeSanity()

    const posts = await getDashboardPosts(
      ctx([livenerGrant]),
      'project-livener',
      { locale: 'en' },
      { fetch },
    )

    expect(
      posts.map((p) => (p as unknown as { _id: string })._id),
      'the Posts list is EMPTY for Livener — the dashboard binds the grant\'s ' +
        '`livener` and no document matched it. Either dashboardPostsQuery lost ' +
        'its `projectSlug == $projectSlug` root filter, or the chokepoint ' +
        'stopped forcing the grant slug.',
    ).toEqual(['post-liv-1', 'post-liv-2'])
  })

  it('returns ONLY Livener documents — including not the retired `-main` row', async () => {
    const fetch = fakeSanity()
    const posts = await getDashboardPosts(
      ctx([livenerGrant]),
      'project-livener',
      { locale: 'en' },
      { fetch },
    )
    const slugs = posts.map((p) => (p as unknown as { projectSlug: string }).projectSlug)
    expect(slugs.every((s) => s === 'livener')).toBe(true)
    expect(posts.map((p) => (p as unknown as { _id: string })._id)).not.toContain('post-stale')
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

  it('is unaffected for a project that never had a second name', async () => {
    // The masking case: `nologo` always had one name in both stores, which is
    // why the defect was invisible for it.
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
// It is now a plain equality on one namespace. The half that matters is the
// second one: only the GRANTED project's own name is accepted, so a genuine
// cross-tenant reference — and a sibling project of the same tenant — is still
// rejected.

describe('assertSameTenantReference', () => {
  const referenceTo = (projectSlug: string | null) =>
    vi.fn(async () => (projectSlug === null ? null : { projectSlug })) as never

  it('ACCEPTS a reference to a document of the same project', async () => {
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('livener'),
    })
    await expect(
      assertSameTenantReference(scoped, 'post-liv-1', livenerGrant),
    ).resolves.toBeUndefined()
  })

  it('REJECTS the retired `-main` name — the alias is gone, not merely unused', async () => {
    // While the Step 3 dual-read stood, BOTH spellings were accepted. Step 5
    // contracted that to one, so a document that somehow still carried the old
    // name would now be treated as foreign: fail-closed, and the honest
    // consequence of the rename being complete.
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('livener-main'),
    })
    await expect(
      assertSameTenantReference(scoped, 'post-liv-1', livenerGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it('REJECTS a genuine cross-tenant reference', async () => {
    const scoped = tenantScopedSanityClient(ctx([livenerGrant]), 'project-livener', {
      fetch: referenceTo('studiomartegani'),
    })
    await expect(
      assertSameTenantReference(scoped, 'post-sm-1', livenerGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it('REJECTS a sibling project of the SAME tenant that the grant does not cover', async () => {
    // `livener-events` shares a prefix with the granted project and is owned by
    // the same tenant. A suffix-stripping or prefix-matching "fix" would let it
    // through; an exact equality does not.
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
      { fetch: referenceTo('livener') },
    )
    await expect(
      assertSameTenantReference(scoped, 'post-liv-1', martiganiGrant),
    ).rejects.toThrow(TenantAuthorizationError)
  })
})
