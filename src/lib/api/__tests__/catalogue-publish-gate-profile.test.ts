// C1.12.4 (D-22) — the publish gate blocks every category (primary AND additional), tag and option
// list that is not used for the item's profile, in EVERY project (no migration markers needed), with
// named findings and fix links. Projects without any "Use for" behave exactly as before.
import { describe, expect, it } from 'vitest'
import { cataloguePublishGate, profileReadinessBlockers } from '../catalogue-publish-gate'
import type { CatalogueSite } from '../catalogue-drafts'
import { profilesWith } from '@/lib/modules/catalogue/profiles'
import type { LifecycleClient, PublishNode } from '@/lib/lifecycle/service'
import type { CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'

const FOOD = profilesWith('foodInformation')[0]
const cat = (key: string, parentKey: string | null, extra: Partial<CategoryNode> = {}): CategoryNode => ({ key, label: { it: key === 'design' ? 'Design' : key }, parentKey, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null, ...extra })

const site = (nodes: CategoryNode[], tags: CatalogueSite['config']['tags'] = []) =>
  ({
    defaultLocale: 'it',
    locales: ['it', 'en'],
    timeZone: null,
    config: { serviceChannels: [], categoryNodes: nodes, tags, migrations: {} },
  }) as unknown as CatalogueSite

const TMZ = [cat('books', null, { useFor: ['book'] }), cat('design', 'books'), cat('food', null, { useFor: [FOOD] }), cat('pizza', 'food')]
const reviewed = { status: 'noneDeclared', confirmed: true }

function client(lists: unknown[] = []) {
  return {
    fetch: async (query: string) => {
      if (query.includes('useFor')) return lists
      if (query.includes('allergenDeclaration')) return [] // option-list choices (D-3a)
      return []
    },
  } as unknown as LifecycleClient
}

const node = (draft: Record<string, unknown>): PublishNode => ({ d: { type: 'catalogueItem', label: () => 'Pizza' } as unknown as PublishNode['d'], id: 'p1', draft, published: undefined, isRoot: true }) as PublishNode

async function attempt(s: CatalogueSite, draft: Record<string, unknown>, c = client()) {
  try {
    await cataloguePublishGate(s, () => 'uuid-1')(node(draft), { client: c, projectSlug: 'tmz' })
    return { ok: true as const }
  } catch (e) {
    return e as { code?: string; detail?: { readiness?: { code: string; values?: Record<string, unknown>; fix: unknown }[] } }
  }
}

describe('gate/blocks — profile applicability (C1.12.4)', () => {
  it('a pizza in Books › Design is refused not_ready with a named finding and a fix link — no migration markers needed', async () => {
    const r = await attempt(site(TMZ), { name: { it: 'Margherita' }, itemProfile: FOOD, allergenDeclaration: reviewed, primaryCategory: 'design' })
    expect(r).toMatchObject({ code: 'not_ready' })
    const f = (r as { detail: { readiness: { code: string; values: Record<string, unknown>; fix: unknown }[] } }).detail.readiness
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ code: 'profileMismatch', values: { kind: 'primary', key: 'design', name: 'Design', profile: FOOD }, fix: { surface: 'item', step: 'category', tab: 'content' } })
  })

  it('an additional category must be compatible too', async () => {
    const r = await attempt(site(TMZ), { name: { it: 'Margherita' }, itemProfile: FOOD, allergenDeclaration: reviewed, primaryCategory: 'pizza', additionalCategories: ['design'] })
    expect((r as { detail: { readiness: { values: Record<string, unknown> }[] } }).detail.readiness.map((x) => x.values.kind)).toEqual(['additional'])
  })

  it('tags and attached option lists (published value, else draft)', async () => {
    const s = site(TMZ, [{ value: 'signed', label: { it: 'Autografato' }, color: null, useFor: ['book'] }])
    const lists = [{ _id: 'drafts.salse', useFor: ['book'], name: 'Salse' }]
    const r = await attempt(s, { name: { it: 'Margherita' }, itemProfile: FOOD, allergenDeclaration: reviewed, primaryCategory: 'pizza', tags: ['signed'], optionLists: [{ list: { _ref: 'salse' }, min: 0 }] }, client(lists))
    const f = (r as { detail: { readiness: { values: Record<string, unknown>; fix: { tab: string } }[] } }).detail.readiness
    expect(f.map((x) => [x.values.kind, x.values.name, x.fix.tab])).toEqual([
      ['tag', 'Autografato', 'content'],
      ['option', 'Salse', 'options'],
    ])
  })

  it('a compatible pizza publishes; a project without any "Use for" never runs the rule', async () => {
    expect(await attempt(site(TMZ), { name: { it: 'Margherita' }, itemProfile: FOOD, allergenDeclaration: reviewed, primaryCategory: 'pizza' })).toEqual({ ok: true })
    const legacy = [cat('design', null), cat('literature', null)]
    expect(await attempt(site(legacy), { name: { it: 'Margherita' }, itemProfile: FOOD, allergenDeclaration: reviewed, primaryCategory: 'design' })).toEqual({ ok: true })
    expect(profileReadinessBlockers(site(legacy) as never, 'p1', { itemProfile: FOOD, primaryCategory: 'design' }, new Map())).toEqual([])
  })
})
