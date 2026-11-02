// C6 §6.7 step 1 — the extracted gate. G-01 `gate-legacy-codes`: every
// pre-existing refusal scenario keeps its CatalogueErrorCode; T-6 (R1 part):
// the drafts API publishes and previews through this one export.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cataloguePublishGate } from '../catalogue-publish-gate'
import type { CatalogueSite } from '../catalogue-drafts'
import { CATALOGUE_FOOD_USERS_COUNT_QUERY, CATALOGUE_OPTION_LIST_CHOICES_QUERY } from '@/lib/modules/catalogue/dashboard-queries'
import { SLUG_NAMESPACE_QUERY } from '@/lib/modules/catalogue/validation'
import type { LifecycleClient, PublishNode } from '@/lib/lifecycle/service'

const site = { defaultLocale: 'it', locales: ['it', 'en'] } as unknown as CatalogueSite
const FOOD = 'foodOrDrink'

function fakeClient(answers: { slugRows?: unknown[]; choiceRows?: unknown[]; foodUsers?: number } = {}) {
  return {
    fetch: async (query: string) => {
      if (query === SLUG_NAMESPACE_QUERY) return answers.slugRows ?? []
      if (query === CATALOGUE_OPTION_LIST_CHOICES_QUERY) return answers.choiceRows ?? []
      if (query === CATALOGUE_FOOD_USERS_COUNT_QUERY) return answers.foodUsers ?? 0
      throw new Error(`unexpected query ${query.slice(0, 40)}`)
    },
  } as unknown as LifecycleClient
}

const node = (type: string, draft: Record<string, unknown>, extra: Partial<PublishNode> = {}): PublishNode =>
  ({ d: { type, label: () => 'Label' } as unknown as PublishNode['d'], id: 'doc1', draft, published: undefined, isRoot: true, ...extra }) as PublishNode

async function codeOf(n: PublishNode, client = fakeClient()) {
  try {
    await cataloguePublishGate(site, () => 'uuid-1')(n, { client, projectSlug: 'p' })
    return 'ok'
  } catch (e) {
    return (e as { code?: string }).code
  }
}

const reviewed = { status: 'noneDeclared', confirmed: true }

describe('G-01 gate-legacy-codes (golden table)', () => {
  it.each([
    ['missing_name', node('catalogueItem', { name: { en: 'Only English' } })],
    ['no_options', node('catalogueOptionList', { name: { it: 'Salse' }, options: [] })],
    ['allergens_not_reviewed', node('catalogueItem', { name: { it: 'Pizza' }, itemProfile: FOOD, allergenDeclaration: { status: 'notReviewed' } })],
    ['slug_without_name', node('catalogueItem', { name: { it: 'Pizza' }, hasPage: true, slug: { en: { current: 'pizza' } } })],
  ])('%s', async (code, n) => {
    expect(await codeOf(n)).toBe(code)
  })

  it('missing_slug — no address in the main language (the main language is not among the generated ones)', async () => {
    const n = node('catalogueItem', { name: { it: 'Pizza' }, hasPage: true })
    const gate = cataloguePublishGate({ ...site, locales: ['en'] } as CatalogueSite, () => 'u')
    await expect(gate(n, { client: fakeClient(), projectSlug: 'p' })).rejects.toMatchObject({ code: 'missing_slug' })
  })

  it('a name with no letters still publishes, with the id-based fallback address (unchanged server behaviour)', async () => {
    const doc = await cataloguePublishGate(site, () => 'u')(node('catalogueItem', { name: { it: '!!!' }, hasPage: true }), { client: fakeClient(), projectSlug: 'p' })
    expect(doc.slug).toMatchObject({ it: { current: 'doc1' } })
  })

  it('option_allergens_not_reviewed — a food item with an unreviewed free-text extra (names the choice)', async () => {
    const n = node('catalogueItem', { name: { it: 'Pizza' }, itemProfile: FOOD, allergenDeclaration: reviewed, optionLists: [{ list: { _ref: 'L1' } }] })
    const client = fakeClient({ choiceRows: [{ _id: 'L1', name: { it: 'Extra' }, options: [{ _key: 'c', kind: 'add', label: { it: 'Mozzarella' }, allergenDeclaration: { status: 'notReviewed' } }] }] })
    await expect(cataloguePublishGate(site, () => 'u')(n, { client, projectSlug: 'p' })).rejects.toMatchObject({ code: 'option_allergens_not_reviewed', detail: { dependencies: [{ id: 'L1', label: 'Extra · Mozzarella' }] } })
  })

  it('option_allergens_not_reviewed — an option list used by a food item', async () => {
    const n = node('catalogueOptionList', { name: { it: 'Extra' }, options: [{ _key: 'c', kind: 'add', label: { it: 'Burrata' }, allergenDeclaration: { status: 'notReviewed' } }] })
    expect(await codeOf(n, fakeClient({ foodUsers: 1 }))).toBe('option_allergens_not_reviewed')
    expect(await codeOf(n, fakeClient({ foodUsers: 0 }))).toBe('ok')
  })

  it('slug_taken — names the other document', async () => {
    const n = node('catalogueItem', { name: { it: 'Menu' }, hasPage: true, slug: { it: { current: 'menu' } } })
    const client = fakeClient({ slugRows: [{ _id: 'c1', _type: 'catalogueCollection', hasPage: true, label: { it: 'Menu' }, slug: { it: { current: 'menu' } } }] })
    expect(await codeOf(n, client)).toBe('slug_taken')
  })

  it('a dependency refusal names the dependency (combined publish)', async () => {
    const n = node('catalogueOptionList', { name: { it: 'Salse' }, options: [] }, { isRoot: false, id: 'L9' })
    await expect(cataloguePublishGate(site, () => 'u')(n, { client: fakeClient(), projectSlug: 'p' })).rejects.toMatchObject({ code: 'no_options', detail: { dependencies: [{ id: 'L9', label: 'Label' }] } })
  })

  it('a passing item returns the published version: lifecycle and system fields dropped, publicId and slug set', async () => {
    const n = node('catalogueItem', { _id: 'drafts.doc1', _rev: 'r', publishedAt: 'x', name: { it: 'Pizza' }, itemProfile: 'product', allergenDeclaration: { status: 'notReviewed' }, hasPage: true })
    const doc = await cataloguePublishGate(site, () => 'uuid-1')(n, { client: fakeClient(), projectSlug: 'p' })
    expect(doc).toMatchObject({ publicId: 'uuid-1', visibility: 'public', slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'pizza' } } })
    expect(doc).not.toHaveProperty('_rev')
    expect(doc).not.toHaveProperty('publishedAt')
    expect(doc).not.toHaveProperty('allergenDeclaration')
  })
})

describe('T-6 (R1 part) gate-is-shared', () => {
  it('catalogue-drafts publishes and previews only through cataloguePublishGate', () => {
    const src = readFileSync(join(__dirname, '..', 'catalogue-drafts.ts'), 'utf8')
    expect(src).toMatch(/import \{[^}]*\bcataloguePublishGate\b[^}]*\} from '@\/lib\/api\/catalogue-publish-gate'/)
    expect(src).not.toMatch(/function cataloguePrepare/)
    expect(src.match(/cataloguePublishGate\(site/g)?.length).toBe(2)
  })
})
