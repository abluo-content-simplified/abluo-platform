/**
 * The status ladder END-TO-END, on a synthetic route table.
 *
 * Why a fixture table: no live project is `draft` or `preview` (all seven rows
 * are `active` or `inactive`), so the real table can only exercise two of the
 * four rungs. This file mocks `generated/route-config` with four projects, one
 * per status, each with all four host kinds, and drives the PUBLIC entry points
 * — `resolveScopeFromHost()`, `resolveScopeFromProjectSegment()`,
 * `isKnownProjectSegment()` — rather than the predicate directly. That is the
 * difference that matters: `status-ladder.test.ts` proves the rule, this file
 * proves the rule is actually WIRED to the two places status is tested.
 *
 * The real-table no-op proof lives in `status-ladder.test.ts`; this file cannot
 * make that claim because it never sees the real table.
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('../generated/route-config', () => {
  const project = (slug: string, status: string, id: string) => [
    {
      host: `${slug}.example.com`,
      hostKind: 'custom-domain',
      tenantSlug: 'fixture',
      projectSlug: slug,
      projectId: id,
      defaultLocale: 'en',
      status,
    },
    {
      host: `${slug}.alias.abluo.app`,
      hostKind: 'platform-alias',
      tenantSlug: 'fixture',
      projectSlug: slug,
      projectId: id,
      defaultLocale: 'en',
      status,
    },
    {
      host: `${slug}.preview.abluo.app`,
      hostKind: 'preview-subdomain',
      tenantSlug: 'fixture',
      projectSlug: slug,
      projectId: id,
      defaultLocale: 'en',
      status,
    },
    {
      host: `${slug}.localhost`,
      hostKind: 'localhost-subdomain',
      tenantSlug: 'fixture',
      projectSlug: slug,
      projectId: id,
      defaultLocale: 'en',
      status,
    },
  ]

  return {
    GENERATED_HOST_ROUTES: [
      ...project('draftco', 'draft', '00000000-0000-0000-0000-00000000000d'),
      ...project('previewco', 'preview', '00000000-0000-0000-0000-00000000000p'),
      ...project('activeco', 'active', '00000000-0000-0000-0000-00000000000a'),
      ...project('retiredco', 'inactive', '00000000-0000-0000-0000-00000000000i'),
      // A row whose status is not one of the four the DB allows — the
      // "somebody widened the check constraint" case, seen through the real
      // resolver rather than through the predicate.
      ...project('futureco', 'scheduled', '00000000-0000-0000-0000-00000000000f'),
    ],
    GENERATED_PLATFORM_HOSTS: ['admin.abluo.app', 'localhost', 'preview.abluo.app'],
  }
})

const {
  resolveScopeFromHost,
  resolveScopeFromProjectSegment,
  defaultLocaleForProjectSegment,
  isKnownProjectSegment,
  lookupHostRoute,
} = await import('../host-scope')
const { asUrlProjectSegment } = await import('../ids')

const hosts = (slug: string) => ({
  custom: `${slug}.example.com`,
  alias: `${slug}.alias.abluo.app`,
  preview: `${slug}.preview.abluo.app`,
  localhost: `${slug}.localhost`,
})

// ─── draft: serves nowhere ───────────────────────────────────────────────────

describe('a draft project (the column DEFAULT) resolves NOWHERE', () => {
  const h = hosts('draftco')

  it.each([h.custom, h.alias, h.preview, h.localhost])('%s → null', (host) => {
    expect(resolveScopeFromHost(host)).toBeNull()
  })

  it('is still in the table — dark, not missing', () => {
    expect(lookupHostRoute(h.preview)?.status).toBe('draft')
    expect(lookupHostRoute(h.custom)?.projectSlug).toBe('draftco')
  })

  it('is not reachable by project segment either', () => {
    expect(resolveScopeFromProjectSegment('draftco')).toBeNull()
    expect(defaultLocaleForProjectSegment('draftco')).toBeNull()
    expect(isKnownProjectSegment(asUrlProjectSegment('draftco'))).toBe(false)
  })
})

// ─── preview: the new rung ───────────────────────────────────────────────────

describe('a preview project serves on preview + localhost ONLY', () => {
  const h = hosts('previewco')

  it('resolves on its preview subdomain', () => {
    expect(resolveScopeFromHost(h.preview)).toEqual({
      tenantSlug: 'fixture',
      projectSlug: 'previewco',
      projectId: '00000000-0000-0000-0000-00000000000p',
      defaultLocale: 'en',
    })
  })

  it('resolves on its localhost subdomain, so local dev can open it', () => {
    expect(resolveScopeFromHost(h.localhost)?.projectSlug).toBe('previewco')
    // …and through the normalisation path a dev actually types.
    expect(resolveScopeFromHost('PreviewCo.localhost:3000')?.projectSlug).toBe('previewco')
  })

  it('does NOT resolve on its custom domain — the public stays out', () => {
    expect(resolveScopeFromHost(h.custom)).toBeNull()
    expect(resolveScopeFromHost(`www.${h.custom}`)).toBeNull()
    expect(resolveScopeFromHost(`${h.custom}:443`)).toBeNull()
  })

  it('does NOT resolve on a platform alias', () => {
    expect(resolveScopeFromHost(h.alias)).toBeNull()
  })

  it('its custom-domain row is present and diagnosable, just not routable', () => {
    // This is the pair an admin UI needs: the domain IS configured, it just
    // does not serve yet. `lookupHostRoute` must keep answering.
    expect(lookupHostRoute(h.custom)?.status).toBe('preview')
    expect(lookupHostRoute(h.custom)?.hostKind).toBe('custom-domain')
    expect(resolveScopeFromHost(h.custom)).toBeNull()
  })

  it('IS reachable by project segment — the route-boundary 404 guard must pass', () => {
    // If this were false, the preview host above would resolve at the edge,
    // rewrite to /en/previewco, and then be 404'd by the [tenant] layout —
    // the ladder defeated one hop downstream.
    expect(resolveScopeFromProjectSegment('previewco')?.projectSlug).toBe('previewco')
    expect(defaultLocaleForProjectSegment('previewco')).toBe('en')
    expect(isKnownProjectSegment(asUrlProjectSegment('previewco'))).toBe(true)
  })
})

// ─── active: unchanged, everywhere ───────────────────────────────────────────

describe('an active project still serves everywhere', () => {
  const h = hosts('activeco')

  it.each([h.custom, h.alias, h.preview, h.localhost])('%s → activeco', (host) => {
    expect(resolveScopeFromHost(host)?.projectSlug).toBe('activeco')
  })

  it('is reachable by project segment', () => {
    expect(isKnownProjectSegment(asUrlProjectSegment('activeco'))).toBe(true)
    expect(defaultLocaleForProjectSegment('activeco')).toBe('en')
  })
})

// ─── inactive: retired, dark everywhere ──────────────────────────────────────

describe('an inactive project serves nowhere — identical to draft', () => {
  const h = hosts('retiredco')

  it.each([h.custom, h.alias, h.preview, h.localhost])('%s → null', (host) => {
    expect(resolveScopeFromHost(host)).toBeNull()
  })

  it('is not reachable by project segment', () => {
    expect(resolveScopeFromProjectSegment('retiredco')).toBeNull()
    expect(isKnownProjectSegment(asUrlProjectSegment('retiredco'))).toBe(false)
  })

  it('routes identically to draft on all four hosts', () => {
    const draft = hosts('draftco')
    expect([h.custom, h.alias, h.preview, h.localhost].map(resolveScopeFromHost)).toEqual(
      [draft.custom, draft.alias, draft.preview, draft.localhost].map(resolveScopeFromHost)
    )
  })
})

// ─── an unknown status, through the real resolver ────────────────────────────

describe('a status this build has never heard of fails closed', () => {
  const h = hosts('futureco')

  it.each([h.custom, h.alias, h.preview, h.localhost])('%s → null', (host) => {
    expect(resolveScopeFromHost(host)).toBeNull()
  })

  it('is not reachable by project segment', () => {
    expect(resolveScopeFromProjectSegment('futureco')).toBeNull()
    expect(isKnownProjectSegment(asUrlProjectSegment('futureco'))).toBe(false)
  })

  it('the row is visible to diagnostics, so the misconfiguration is findable', () => {
    expect(lookupHostRoute(h.preview)?.status).toBe('scheduled')
  })
})

// ─── the two status tests agree with each other ──────────────────────────────

describe('host resolution and segment resolution never disagree about a project', () => {
  it('a project reachable by segment is reachable on at least one host, and vice versa', () => {
    for (const slug of ['draftco', 'previewco', 'activeco', 'retiredco', 'futureco']) {
      const h = hosts(slug)
      const anyHost = [h.custom, h.alias, h.preview, h.localhost].some(
        (host) => resolveScopeFromHost(host) !== null
      )
      const bySegment = resolveScopeFromProjectSegment(slug) !== null
      expect(bySegment, slug).toBe(anyHost)
    }
  })

  it('the segment surface is exactly as permissive as a preview host, never more', () => {
    // The segment map is judged at 'preview-subdomain'. So: anything that
    // serves on a preview host serves by segment, and nothing else does.
    for (const slug of ['draftco', 'previewco', 'activeco', 'retiredco', 'futureco']) {
      const onPreviewHost = resolveScopeFromHost(hosts(slug).preview) !== null
      expect(resolveScopeFromProjectSegment(slug) !== null, slug).toBe(onPreviewHost)
    }
  })
})
