// @vitest-environment jsdom
/**
 * Catalogue → Setup screens (R2-B) with the server actions mocked: what each form sends, the
 * impact / currency / counted-removal confirmations, the taxonomy.write-only limits (disabled
 * controls that say why), refusals in plain words, and no hand-made UI in Setup code.
 */
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { byName, click, key, mount, typeInto, type Mounted } from '@/components/app/ui/__tests__/intl-dom'
import { scanHandmade } from '@/lab/handmade'

vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a> }))

const a = vi.hoisted(() => ({
  listCatalogueTaxonomyAction: vi.fn(),
  createCatalogueCategoryAction: vi.fn(),
  updateCatalogueCategoryAction: vi.fn(),
  reorderCatalogueCategoriesAction: vi.fn(),
  previewCatalogueCategoryMoveAction: vi.fn(),
  moveCatalogueCategoryAction: vi.fn(),
  archiveCatalogueCategoryAction: vi.fn(),
  previewCatalogueCategoryRuleAction: vi.fn(),
  setCatalogueCategoryRuleAction: vi.fn(),
  previewCatalogueCategoryDeletionAction: vi.fn(),
  deleteCatalogueCategoryAction: vi.fn(),
  createCatalogueTagAction: vi.fn(),
  updateCatalogueTagAction: vi.fn(),
  reorderCatalogueTagsAction: vi.fn(),
  archiveCatalogueTagAction: vi.fn(),
  deleteCatalogueTagAction: vi.fn(),
  loadCatalogueSettingsAction: vi.fn(),
  saveCatalogueChannelsAction: vi.fn(),
  previewCatalogueChannelRemovalAction: vi.fn(),
  removeCatalogueChannelAction: vi.fn(),
  saveCatalogueSettingsAction: vi.fn(),
  completeCatalogueSetupAction: vi.fn(),
}))
vi.mock('@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions', () => a)
vi.mock('@/app/[locale]/(client)/[tenant]/catalogue/setup/settings-actions', () => a)

import { CategoriesSetup } from '../CategoriesSetup'
import { ServiceChannels } from '../ServiceChannels'
import { PublicWebsite } from '../PublicWebsite'
import { ItemDefaults } from '../ItemDefaults'
import type { ChannelDraft } from '../setup-model'

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as { showModal: () => void; close: () => void }
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never
})

let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})
beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset()
})

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0))
})
const body = () => document.body
const text = () => document.body.textContent ?? ''
const status = () => [...document.body.querySelectorAll('[role="status"]')].map((s) => s.textContent).join(' ')
const menu = async (name: string, item: string) => {
  const opener = byName(body(), 'button', `More for ${name}`)
  click(opener)
  const list = document.getElementById(opener!.getAttribute('aria-controls') ?? '')
  click(byName(list!, 'button', item))
  await flush()
}
/** A button inside the open dialog(s), by its text. */
const inDialog = (label: string) => [...body().querySelectorAll('dialog[open] button')].find((b) => b.textContent === label) ?? null

const cat = (k: string, parentKey: string | null, order: number, extra: Record<string, unknown> = {}) => ({
  key: k,
  label: { en: k[0].toUpperCase() + k.slice(1) },
  parentKey,
  order,
  channelRules: {},
  defaultOptionListIds: [],
  archivedAt: null,
  depth: parentKey ? 1 : 0,
  childCount: 0,
  hash: `h-${k}`,
  items: 2,
  ...extra,
})
const taxonomyView = (can: { write: boolean; manage: boolean }) => ({
  rev: 'r1',
  exists: true,
  defaultLocale: 'en',
  locales: ['en'],
  categories: [cat('food', null, 1000), cat('pizza', 'food', 1000), cat('pasta', 'food', 2000), cat('drinks', null, 2000)],
  tags: [
    { key: 'new', label: { en: 'New' }, order: 1000, archivedAt: null, hash: 'h-new', items: 0 },
    { key: 'house', label: { en: 'House favourite' }, order: 2000, archivedAt: null, hash: 'h-house', items: 3 },
  ],
  issues: [],
  channels: [{ key: 'delivery', label: { en: 'Delivery' }, active: true }],
  can,
})
const DELIVERY: ChannelDraft = { key: 'delivery', label: { en: 'Delivery' }, active: true, defaultAvailability: 'available', defaultSchedule: [], explicitDefault: true }

function openCategories(can: { write: boolean; manage: boolean }) {
  const view = taxonomyView(can)
  a.listCatalogueTaxonomyAction.mockResolvedValue({ ok: true, taxonomy: view })
  m = mount(<CategoriesSetup projectSlug="site-a" initial={view as never} channels={[DELIVERY]} backHref={can.manage ? '/site-a/catalogue/setup' : null} />)
}

describe('Categories & Tags — catalogue.taxonomy.write only', () => {
  it('reorders siblings (the new order of the parent’s children, with rev and fingerprints)', async () => {
    openCategories({ write: true, manage: false })
    a.reorderCatalogueCategoriesAction.mockResolvedValue({ ok: true, order: [], rev: 'r2' })
    key(byName(body(), 'button', /^Move Pasta,/), 'ArrowUp')
    await flush()
    expect(a.reorderCatalogueCategoriesAction).toHaveBeenCalledWith(expect.objectContaining({ projectSlug: 'site-a', parentKey: 'food', keys: ['pasta', 'pizza'], rev: 'r1', baseHashes: expect.objectContaining({ food: 'h-food', 'tag:new': 'h-new' }) }))
  })

  it('moving into another parent is refused with the reason, shown and announced; nothing is sent', async () => {
    openCategories({ write: true, manage: false })
    expect(text()).toContain('Moving a category into another one needs the Manage Catalogue Setup permission.')
    key(byName(body(), 'button', /^Move Pasta,/), 'ArrowRight')
    await flush()
    expect(status()).toContain('Moving a category into another one needs the Manage Catalogue Setup permission.')
    expect(a.previewCatalogueCategoryMoveAction).not.toHaveBeenCalled()
    expect(a.moveCatalogueCategoryAction).not.toHaveBeenCalled()
    // The ⋯ menu offers only up / down.
    click(byName(body(), 'button', 'More for Pasta'))
    expect(byName(body(), 'button', /^Move into/)).toBeNull()
    expect(byName(body(), 'button', 'Move up')).not.toBeNull()
  })

  it('availability rules and archiving are shown disabled with the reason; no way back to an Overview it cannot open', async () => {
    openCategories({ write: true, manage: false })
    expect(byName(body(), 'a', 'Setup')).toBeNull()
    await menu('Pizza', 'Details and availability')
    expect(text()).toContain('Changing availability needs the Manage Catalogue Setup permission.')
    expect(text()).toContain('Archiving needs the Manage Catalogue Setup permission.')
    expect((byName(body(), 'button', 'Archive') as HTMLButtonElement).disabled).toBe(true)
  })

  it('deleting a category in use: the blockers are counted and Delete says it needs the Setup permission', async () => {
    openCategories({ write: true, manage: false })
    a.previewCatalogueCategoryDeletionAction.mockResolvedValue({
      ok: true,
      preview: { key: 'pizza', blockers: [{ code: 'used_as_primary', count: 3, cleanable: true, sample: [{ id: 'i1', type: 'catalogueItem', name: 'Margherita' }] }], route: { capability: 'setup.manage', resolvable: true }, plan: null },
    })
    await menu('Pizza', 'Delete')
    expect(text()).toContain('3 items use it as their main category (Margherita)')
    expect(text()).toContain('This needs the “Manage Catalogue Setup” permission.')
    const del = inDialog('Delete') as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(a.deleteCatalogueCategoryAction).not.toHaveBeenCalled()
  })

  it('adds a category with its place, previewing the full path', async () => {
    openCategories({ write: true, manage: false })
    a.createCatalogueCategoryAction.mockResolvedValue({ ok: true, category: { key: 'bianche' }, path: { text: 'Food › Pizza › Bianche' }, created: true, rev: 'r2' })
    click(byName(body(), 'button', 'Add Category'))
    typeInto(body().querySelector('dialog[open] input'), 'Bianche')
    typeInto(body().querySelector('dialog[open] select'), 'pizza')
    expect(text()).toContain('It will appear as: Food › Pizza › Bianche')
    click(inDialog('Add'))
    await flush()
    expect(a.createCatalogueCategoryAction).toHaveBeenCalledWith({ projectSlug: 'site-a', labels: { en: 'Bianche' }, parentKey: 'pizza', locale: 'en' })
    expect(text()).toContain('Added: Food › Pizza › Bianche.')
  })

  it('a conflict reloads the list and names what changed elsewhere', async () => {
    openCategories({ write: true, manage: false })
    a.reorderCatalogueCategoriesAction.mockResolvedValue({ ok: false, error: 'category_conflict', detail: { changedKeys: ['pizza'] } })
    key(byName(body(), 'button', /^Move Pasta,/), 'ArrowUp')
    await flush()
    expect(a.listCatalogueTaxonomyAction).toHaveBeenCalled()
    expect(text()).toContain('Categories were changed elsewhere. Review the changes, then try again. Changed elsewhere: Pizza.')
  })
})

describe('Categories & Tags — Setup permission', () => {
  it('a category rule change is previewed with its impact and saved only after confirming', async () => {
    openCategories({ write: true, manage: true })
    a.previewCatalogueCategoryRuleAction.mockResolvedValue({ ok: true, preview: { before: 'inherit', after: 'x', impact: { items: 3, formats: 4, toAvailable: 0, toUnavailable: 4, shieldedByOverride: 1 } } })
    a.setCatalogueCategoryRuleAction.mockResolvedValue({ ok: true, preview: {}, category: {}, rev: 'r2' })
    await menu('Pizza', 'Details and availability')
    click(byName(body(), 'button', 'Unavailable'))
    click(byName(body(), 'button', 'Review change on Delivery'))
    await flush()
    expect(a.previewCatalogueCategoryRuleAction).toHaveBeenCalledWith({ projectSlug: 'site-a', key: 'pizza', channel: 'delivery', rule: { state: 'unavailable', overrides: [] } })
    expect(text()).toContain('3 items and 4 formats change on Delivery; 1 explicit override kept.')
    expect(a.setCatalogueCategoryRuleAction).not.toHaveBeenCalled()
    click(inDialog('Save rule'))
    await flush()
    expect(a.setCatalogueCategoryRuleAction).toHaveBeenCalledWith(expect.objectContaining({ key: 'pizza', channel: 'delivery', rule: { state: 'unavailable', overrides: [] }, rev: 'r1' }))
  })

  it('a move into another parent with availability impact asks first', async () => {
    openCategories({ write: true, manage: true })
    a.previewCatalogueCategoryMoveAction.mockResolvedValue({ ok: true, impact: { items: 2, formats: 2, availability: { items: 2, formats: 2, toAvailable: 0, toUnavailable: 2, shieldedByOverride: 0 } } })
    a.moveCatalogueCategoryAction.mockResolvedValue({ ok: true, category: {}, impact: {}, rev: 'r2' })
    key(byName(body(), 'button', /^Move Pasta,/), 'ArrowRight')
    await flush()
    expect(text()).toContain('Move Pasta into Pizza?')
    expect(a.moveCatalogueCategoryAction).not.toHaveBeenCalled()
    click(inDialog('Move category'))
    await flush()
    expect(a.moveCatalogueCategoryAction).toHaveBeenCalledWith(expect.objectContaining({ key: 'pasta', newParentKey: 'pizza', index: 0, rev: 'r1' }))
  })

  it('deleting a category in use: choose where items and sub-categories go, see the plan, then delete', async () => {
    openCategories({ write: true, manage: true })
    a.previewCatalogueCategoryDeletionAction
      .mockResolvedValueOnce({
        ok: true,
        preview: { key: 'food', blockers: [{ code: 'used_as_primary', count: 3, cleanable: true, sample: [] }, { code: 'has_children', count: 2, cleanable: true, sample: [] }], route: { capability: 'setup.manage', resolvable: true }, plan: null },
      })
      .mockResolvedValueOnce({ ok: true, preview: { key: 'food', blockers: [], route: { capability: 'setup.manage', resolvable: true }, plan: { ok: true, steps: [{ kind: 'move_children', count: 2 }, { kind: 'reassign_items', count: 3 }] } } })
    a.deleteCatalogueCategoryAction.mockResolvedValue({ ok: true, result: { key: 'food', deleted: true, reassigned: 3, childrenMoved: 2, rev: 'r2' } })
    await menu('Food', 'Delete')
    expect(text()).toContain('Choose where its items and sub-categories go first.')
    click(body().querySelector('input[name="delete-items"][value="remove"]'))
    click(inDialog('Delete'))
    await flush()
    expect(a.previewCatalogueCategoryDeletionAction).toHaveBeenLastCalledWith({ projectSlug: 'site-a', key: 'food', reassignTo: null, promoteChildrenTo: 'parent' })
    expect(text()).toContain('2 sub-categories move. 3 items change category. Then the category is deleted.')
    click(inDialog('Delete category'))
    await flush()
    expect(a.deleteCatalogueCategoryAction).toHaveBeenCalledWith({ projectSlug: 'site-a', key: 'food', rev: 'r1', reassignTo: null, promoteChildrenTo: 'parent' })
    expect(text()).toContain('Food deleted. 3 items moved. 2 sub-categories moved.')
  })
})

describe('Tags', () => {
  it('reorder sends the whole new order; a tag still on items offers archiving instead of deleting', async () => {
    openCategories({ write: true, manage: false })
    a.reorderCatalogueTagsAction.mockResolvedValue({ ok: true, order: [], rev: 'r2' })
    a.archiveCatalogueTagAction.mockResolvedValue({ ok: true, tag: {}, rev: 'r2' })
    click(byName(body(), 'button', /^Tags/))
    expect(text()).toContain('Tags have no levels: only their order can change.')
    key(byName(body(), 'button', /^Move House favourite,/), 'ArrowUp')
    await flush()
    expect(a.reorderCatalogueTagsAction).toHaveBeenCalledWith(expect.objectContaining({ keys: ['house', 'new'], rev: 'r1' }))
    await menu('House favourite', 'Delete')
    expect(text()).toContain('3 items still use this tag, so it can’t be deleted.')
    click(inDialog('Archive'))
    await flush()
    expect(a.archiveCatalogueTagAction).toHaveBeenCalledWith({ projectSlug: 'site-a', key: 'house', archived: true })
    expect(a.deleteCatalogueTagAction).not.toHaveBeenCalled()
  })
})

// ── Service channels ─────────────────────────────────────────────────────────

const settings = (over: Record<string, unknown> = {}) => ({
  rev: 's1',
  defaultLocale: 'en',
  locales: ['en', 'it'],
  channels: [
    { key: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available', defaultSchedule: [], explicitDefault: true },
    { key: 'delivery', label: { en: 'Delivery', it: 'Consegna' }, active: false, defaultAvailability: 'available', defaultSchedule: [], explicitDefault: true },
  ],
  currency: 'EUR',
  publicSegment: 'menu',
  publicSegmentHistory: ['carta', 'menu'],
  publicName: { en: 'Menu' },
  defaultItemProfile: null,
  showPricesByDefault: true,
  formatTemplates: [],
  dietaryTags: [],
  setup: { completedAt: null, source: null },
  can: { manage: true },
  ...over,
})

describe('Service Channels', () => {
  it('switching a channel on shows its impact, then saves with confirmImpact', async () => {
    const view = settings()
    a.loadCatalogueSettingsAction.mockResolvedValue({ ok: true, settings: view })
    a.saveCatalogueChannelsAction
      .mockResolvedValueOnce({ ok: true, saved: false, changes: [{ kind: 'channel.activated', channelKey: 'delivery', impact: { items: 5, formats: 5, toAvailable: 5, toUnavailable: 0, shieldedByOverride: 0 } }], rev: 's1' })
      .mockResolvedValueOnce({ ok: true, saved: true, changes: [], rev: 's2' })
    m = mount(<ServiceChannels projectSlug="site-a" initial={view as never} backHref="/site-a/catalogue/setup" />)
    await menu('Delivery', 'Switch on')
    const sent = a.saveCatalogueChannelsAction.mock.calls[0][0]
    expect(sent).toMatchObject({ projectSlug: 'site-a', rev: 's1', confirmImpact: false })
    expect(sent.channels).toEqual([
      { key: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available', defaultSchedule: [] },
      { key: 'delivery', label: { en: 'Delivery', it: 'Consegna' }, active: true, defaultAvailability: 'available', defaultSchedule: [] },
    ])
    expect(text()).toContain('Switch on Delivery?')
    expect(text()).toContain('5 items and 5 formats change on Delivery.')
    click(inDialog('Save changes'))
    await flush()
    expect(a.saveCatalogueChannelsAction.mock.calls[1][0]).toMatchObject({ confirmImpact: true, channels: sent.channels })
    expect(text()).toContain('Delivery is switched on.')
  })

  it('adds a channel with a key made from its name, off unless ticked', async () => {
    const view = settings()
    a.loadCatalogueSettingsAction.mockResolvedValue({ ok: true, settings: view })
    a.saveCatalogueChannelsAction.mockResolvedValue({ ok: true, saved: true, changes: [], rev: 's2' })
    m = mount(<ServiceChannels projectSlug="site-a" initial={view as never} backHref="/site-a/catalogue/setup" />)
    click(byName(body(), 'button', 'Add Channel'))
    typeInto(body().querySelector('dialog[open] input'), 'Take-away')
    click(inDialog('Add Channel'))
    await flush()
    const sent = a.saveCatalogueChannelsAction.mock.calls[0][0].channels
    expect(sent[2]).toEqual({ key: 'take-away', label: { en: 'Take-away' }, active: false, defaultAvailability: 'available', defaultSchedule: [] })
  })

  it('removing a channel shows the counted cleanup; changed counts are shown again before anything is removed', async () => {
    const view = settings()
    a.loadCatalogueSettingsAction.mockResolvedValue({ ok: true, settings: view })
    const usage = { prices: 2, itemRules: 1, formatRules: 0, categoryRules: 1 }
    a.previewCatalogueChannelRemovalAction.mockResolvedValue({ ok: true, key: 'delivery', usage })
    a.removeCatalogueChannelAction.mockResolvedValueOnce({ ok: false, error: 'channel_usage_changed', detail: { usage: { ...usage, prices: 4 } } }).mockResolvedValueOnce({ ok: true, key: 'delivery', cleanup: usage, rev: 's2' })
    m = mount(<ServiceChannels projectSlug="site-a" initial={view as never} backHref="/site-a/catalogue/setup" />)
    await menu('Delivery', 'Remove')
    expect(text()).toContain('This also removes 2 prices, 1 item rule and 1 category rule for this channel.')
    click(inDialog('Remove channel and these'))
    await flush()
    expect(a.removeCatalogueChannelAction).toHaveBeenLastCalledWith({ projectSlug: 'site-a', rev: 's1', key: 'delivery', expected: usage })
    expect(text()).toContain('This also removes 4 prices')
    expect(text()).toContain('Something changed in the meantime')
    click(inDialog('Remove channel and these'))
    await flush()
    expect(a.removeCatalogueChannelAction).toHaveBeenLastCalledWith(expect.objectContaining({ expected: { ...usage, prices: 4 } }))
    expect(text()).toContain('Delivery removed.')
  })

  it('without the Setup permission nothing can be changed and the reason is shown', () => {
    const view = settings({ can: { manage: false } })
    m = mount(<ServiceChannels projectSlug="site-a" initial={view as never} backHref="/site-a/catalogue/setup" />)
    expect((byName(body(), 'button', 'Add Channel') as HTMLButtonElement).disabled).toBe(true)
    expect(text()).toContain('Changing channels needs the Manage Catalogue Setup permission.')
    expect(byName(body(), 'button', 'More for Delivery')).toBeNull()
  })
})

// ── Public website / item defaults ───────────────────────────────────────────

describe('Public Website', () => {
  const open = () => {
    const view = settings()
    a.loadCatalogueSettingsAction.mockResolvedValue({ ok: true, settings: view })
    m = mount(<PublicWebsite projectSlug="site-a" initial={view as never} backHref="/site-a/catalogue/setup" currencies={['EUR', 'GBP']} timeZone="Europe/Rome" settingsHref="/site-a/settings" siteAddress="example.com" />)
  }

  it('a currency change that reinterprets prices asks first, then saves with confirmCurrency', async () => {
    open()
    a.saveCatalogueSettingsAction
      .mockResolvedValueOnce({ ok: true, saved: false, rev: 's1', confirmation: { currency: { prices: 12, items: 4, optionDeltas: 0, optionLists: 0, from: 'EUR', to: 'GBP' } } })
      .mockResolvedValueOnce({ ok: true, saved: true, rev: 's2' })
    typeInto(body().querySelectorAll('select')[0], 'GBP')
    click(byName(body(), 'button', 'Save currency'))
    await flush()
    expect(a.saveCatalogueSettingsAction).toHaveBeenLastCalledWith({ projectSlug: 'site-a', rev: 's1', set: { currency: 'GBP' }, confirmCurrency: undefined })
    expect(text()).toContain('12 prices across 4 items will be read as GBP. No amounts are converted.')
    click(inDialog('Change currency'))
    await flush()
    expect(a.saveCatalogueSettingsAction).toHaveBeenLastCalledWith({ projectSlug: 'site-a', rev: 's1', set: { currency: 'GBP' }, confirmCurrency: true })
  })

  it('a refused web address says why, under the field; earlier addresses are listed', async () => {
    open()
    expect(text()).toContain('Earlier addresses keep working and redirect here: /carta')
    a.saveCatalogueSettingsAction.mockResolvedValue({ ok: false, error: 'segment_invalid', detail: { clash: { kind: 'reserved', value: 'admin' } } })
    const input = [...body().querySelectorAll('input')].find((i) => (i as HTMLInputElement).value === 'menu')!
    typeInto(input, 'admin')
    expect(text()).toContain('Address: example.com/admin')
    click(byName(body(), 'button', 'Save address'))
    await flush()
    expect(a.saveCatalogueSettingsAction).toHaveBeenCalledWith(expect.objectContaining({ set: { publicSegment: 'admin' } }))
    expect(text()).toContain('"admin" is already used by the website. Choose another word.')
  })

  it('the public name sends only the languages that changed; a missing permission is named', async () => {
    open()
    a.saveCatalogueSettingsAction.mockResolvedValue({ ok: false, error: 'forbidden', capability: 'catalogue.setup.manage' })
    const it = [...body().querySelectorAll('input')].find((i) => i.getAttribute('lang') === 'it')!
    typeInto(it, 'Menù')
    click(byName(body(), 'button', 'Save name'))
    await flush()
    expect(a.saveCatalogueSettingsAction).toHaveBeenCalledWith(expect.objectContaining({ set: { publicName: { it: 'Menù' } } }))
    expect(text()).toContain('This needs the “Manage Catalogue Setup” permission. Ask the site’s owner to give it to you.')
  })
})

describe('Item Defaults', () => {
  it('the default profile saves at once; a size template is sent with its quantity', async () => {
    const view = settings()
    a.loadCatalogueSettingsAction.mockResolvedValue({ ok: true, settings: view })
    a.saveCatalogueSettingsAction.mockResolvedValue({ ok: true, saved: true, rev: 's2' })
    m = mount(<ItemDefaults projectSlug="site-a" initial={view as never} backHref="/site-a/catalogue/setup" />)
    click(body().querySelector('input[name="default-item-profile"][value="foodOrDrink"]'))
    await flush()
    expect(a.saveCatalogueSettingsAction).toHaveBeenLastCalledWith({ projectSlug: 'site-a', rev: 's1', set: { defaultItemProfile: 'foodOrDrink' } })
    click(byName(body(), 'button', 'Add Size Template'))
    const inputs = body().querySelectorAll('dialog[open] input')
    typeInto(inputs[0], 'Bottle')
    typeInto(inputs[2], '0,75')
    typeInto(body().querySelector('dialog[open] select'), 'l')
    click(inDialog('Add Size Template'))
    await flush()
    expect(a.saveCatalogueSettingsAction).toHaveBeenLastCalledWith({ projectSlug: 'site-a', rev: 's1', set: { formatTemplates: [{ key: 'bottle', label: { en: 'Bottle' }, quantity: { value: 0.75, unit: 'l' } }] } })
  })
})

describe('Lab guards: Setup is built from shared components only', () => {
  it('no hand-made button, field, dialog, box, pill or loading block in the Setup screens and routes', () => {
    const found = Object.keys(scanHandmade(process.cwd())).filter((f) => f.includes('catalogue/setup'))
    expect(found).toEqual([])
  })
})
