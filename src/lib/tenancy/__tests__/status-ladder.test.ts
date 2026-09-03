/**
 * The `projects.status` × `hostKind` routing ladder — against the REAL table.
 *
 * Companion file: `status-ladder-fixtures.test.ts` runs the same ladder
 * end-to-end through `resolveScopeFromHost()` on a synthetic table, because
 * no live project is `draft` or `preview` and the real table therefore cannot
 * exercise two of the four rungs.
 *
 * ── Why the matrix below is typed out by hand ────────────────────────────────
 * All 16 outcomes are literal. They are NOT derived from `PROJECT_STATUSES`,
 * from `GeneratedHostKind`, or from any structure `servesOnHostKind()` reads —
 * a matrix generated from the implementation's own data proves only that the
 * implementation is self-consistent. This one is a transcription of the ladder
 * Tom approved, and it fails if the implementation stops matching that ladder.
 */

import { describe, it, expect } from 'vitest'
import {
  servesOnHostKind,
  isProjectStatus,
  PROJECT_STATUSES,
  resolveScopeFromHost,
  resolveScopeFromProjectSegment,
  isKnownProjectSegment,
  lookupHostRoute,
} from '../host-scope'
import { asUrlProjectSegment } from '../ids'
import { GENERATED_HOST_ROUTES } from '../generated/route-config'

// ─── 1. The full 4 × 4 matrix, enumerated ────────────────────────────────────

describe('servesOnHostKind: all 16 status × hostKind outcomes', () => {
  const MATRIX: Array<[status: string, hostKind: string, serves: boolean, why: string]> = [
    // draft — serves NOWHERE. It is the column default, so a brand-new project
    // is dark everywhere until somebody promotes it.
    ['draft', 'custom-domain', false, 'draft is never public'],
    ['draft', 'platform-alias', false, 'draft is never public'],
    ['draft', 'preview-subdomain', false, 'draft is not even previewable'],
    ['draft', 'localhost-subdomain', false, 'draft is not even previewable'],

    // preview — the new rung. Non-public surfaces only.
    ['preview', 'custom-domain', false, 'the client can review it, the public cannot'],
    ['preview', 'platform-alias', false, 'a platform alias is a public surface too'],
    ['preview', 'preview-subdomain', true, 'this is what preview status is FOR'],
    ['preview', 'localhost-subdomain', true, 'local dev must be able to open it'],

    // active — everywhere. This rung must be byte-identical to the old
    // `status === "active"` test, on all four kinds.
    ['active', 'custom-domain', true, 'live site'],
    ['active', 'platform-alias', true, 'live site'],
    ['active', 'preview-subdomain', true, 'live site'],
    ['active', 'localhost-subdomain', true, 'live site'],

    // inactive — serves NOWHERE. Retired. Same routing as draft, on purpose.
    ['inactive', 'custom-domain', false, 'retired'],
    ['inactive', 'platform-alias', false, 'retired'],
    ['inactive', 'preview-subdomain', false, 'retired'],
    ['inactive', 'localhost-subdomain', false, 'retired'],
  ]

  it('enumerates every combination exactly once — 4 statuses × 4 host kinds', () => {
    expect(MATRIX).toHaveLength(16)
    const seen = new Set(MATRIX.map(([s, k]) => `${s}|${k}`))
    expect(seen.size).toBe(16)
    // The four statuses in the matrix are the four the database allows.
    expect([...new Set(MATRIX.map(([s]) => s))].sort()).toEqual(
      ['active', 'draft', 'inactive', 'preview'].sort()
    )
    // The four host kinds in the matrix are the four the generator emits.
    expect([...new Set(MATRIX.map(([, k]) => k))].sort()).toEqual([
      'custom-domain',
      'localhost-subdomain',
      'platform-alias',
      'preview-subdomain',
    ])
  })

  it.each(MATRIX)('%s on %s → %s (%s)', (status, hostKind, serves) => {
    expect(servesOnHostKind(status, hostKind as never)).toBe(serves)
  })

  it('draft and inactive are identical on every host kind, deliberately', () => {
    for (const kind of [
      'custom-domain',
      'platform-alias',
      'preview-subdomain',
      'localhost-subdomain',
    ] as const) {
      expect(servesOnHostKind('draft', kind), kind).toBe(servesOnHostKind('inactive', kind))
      expect(servesOnHostKind('draft', kind), kind).toBe(false)
    }
  })

  it('preview is strictly weaker than active and strictly stronger than draft', () => {
    const kinds = [
      'custom-domain',
      'platform-alias',
      'preview-subdomain',
      'localhost-subdomain',
    ] as const
    const count = (s: string) => kinds.filter((k) => servesOnHostKind(s, k)).length
    expect(count('active')).toBe(4)
    expect(count('preview')).toBe(2)
    expect(count('draft')).toBe(0)
    expect(count('inactive')).toBe(0)
  })
})

// ─── 2. Exhaustiveness / fail-closed ─────────────────────────────────────────

describe('servesOnHostKind fails closed on anything it does not know', () => {
  const ALL_KINDS = [
    'custom-domain',
    'platform-alias',
    'preview-subdomain',
    'localhost-subdomain',
  ] as const

  it.each([
    'archived',
    'suspended',
    'ACTIVE',
    'Active',
    'active ',
    ' active',
    'preview-subdomain',
    '',
    'null',
    'undefined',
    '*',
    'true',
  ])('an unknown status %o serves on NO host kind', (status) => {
    for (const kind of ALL_KINDS) {
      expect(servesOnHostKind(status, kind), `${status} on ${kind}`).toBe(false)
    }
  })

  it('a fifth status added to the DB check constraint would be dark, not public', () => {
    // The scenario: somebody widens the constraint to allow 'scheduled' and
    // does not touch this module. The safe failure is a site that does not
    // serve, never a site that serves where it should not.
    expect(servesOnHostKind('scheduled', 'custom-domain')).toBe(false)
    expect(servesOnHostKind('scheduled', 'preview-subdomain')).toBe(false)
  })

  it('an unknown host kind never turns a non-active status public', () => {
    // hostKind is typed, but the row's value is generated data; a widened
    // generator must not make `preview` leak onto a new kind by default.
    expect(servesOnHostKind('preview', 'vercel-alias' as never)).toBe(false)
    expect(servesOnHostKind('draft', 'vercel-alias' as never)).toBe(false)
    // `active` still serves everywhere — that IS the definition of active.
    expect(servesOnHostKind('active', 'vercel-alias' as never)).toBe(true)
  })

  it('isProjectStatus recognises exactly the four DB values', () => {
    expect([...PROJECT_STATUSES].sort()).toEqual(['active', 'draft', 'inactive', 'preview'])
    for (const s of PROJECT_STATUSES) expect(isProjectStatus(s)).toBe(true)
    for (const s of ['archived', 'ACTIVE', '', 'live']) expect(isProjectStatus(s)).toBe(false)
  })
})

// ─── 3. NO-OP PROOF: every live host resolves exactly as it does today ───────

/**
 * The snapshot below is the resolver's behaviour BEFORE the ladder existed,
 * transcribed by hand from `generated/route-config.ts` under the old rule
 * (`status === 'active'` or nothing). Every live row is `active` or `inactive`,
 * and the ladder changes neither of those rungs — so this whole table must be
 * unchanged. If a single line of it moves, the change was not a no-op.
 */
const LIVE_HOST_SNAPSHOT: Array<[host: string, projectSlug: string | null]> = [
  ['abluo.app', 'abluo'],
  ['abluo.localhost', 'abluo'],
  ['abluo.preview.abluo.app', 'abluo'],
  ['amelie.localhost', 'amelie'],
  ['amelie.preview.abluo.app', 'amelie'],
  ['ch-psicoterapeuta.com', 'hoffmann'],
  ['dev.abluo.app', 'abluo'],
  ['hoffmann.localhost', 'hoffmann'],
  ['hoffmann.preview.abluo.app', 'hoffmann'],
  ['livener.localhost', 'livener'],
  ['livener.net', 'livener'],
  ['livener.preview.abluo.app', 'livener'],
  ['nologo.cloud', 'nologo'],
  ['nologo.localhost', 'nologo'],
  ['nologo.preview.abluo.app', 'nologo'],
  ['studiomartegani.com', 'studiomartegani'],
  ['studiomartegani.localhost', 'studiomartegani'],
  ['studiomartegani.preview.abluo.app', 'studiomartegani'],
  // The two inactive rows: present in the table, dark on every surface. This is
  // the rung the ladder most easily breaks, and it must not move.
  ['t42.localhost', null],
  ['t42.preview.abluo.app', null],
]

describe('no-op proof: the ladder changes nothing for any live host', () => {
  it('covers every host in the generated table, with nothing left over', () => {
    expect(LIVE_HOST_SNAPSHOT.map(([h]) => h).sort()).toEqual(
      GENERATED_HOST_ROUTES.map((r) => r.host).sort()
    )
  })

  it.each(LIVE_HOST_SNAPSHOT)('%s → %s', (host, projectSlug) => {
    expect(resolveScopeFromHost(host)?.projectSlug ?? null).toBe(projectSlug)
  })

  it('every live row is active or inactive — the two rungs this change does not touch', () => {
    const statuses = [...new Set(GENERATED_HOST_ROUTES.map((r) => r.status))].sort()
    expect(statuses).toEqual(['active', 'inactive'])
  })

  it('the new predicate agrees with the OLD active-only rule on every live row', () => {
    for (const route of GENERATED_HOST_ROUTES) {
      const oldRule = route.status === 'active'
      expect(servesOnHostKind(route.status, route.hostKind), route.host).toBe(oldRule)
    }
  })

  it('leaves the project-segment surfaces exactly as they were', () => {
    // Six active projects are reachable by segment; t42 is not.
    const segments = ['abluo', 'amelie', 'hoffmann', 'livener', 'nologo', 'studiomartegani']
    for (const segment of segments) {
      expect(resolveScopeFromProjectSegment(segment)?.projectSlug, segment).toBe(segment)
      expect(isKnownProjectSegment(asUrlProjectSegment(segment)), segment).toBe(true)
    }
    expect(resolveScopeFromProjectSegment('t42')).toBeNull()
    expect(isKnownProjectSegment(asUrlProjectSegment('t42'))).toBe(false)
    // And t42's row is still THERE — dark, not deleted.
    expect(lookupHostRoute('t42.preview.abluo.app')?.status).toBe('inactive')
  })
})
