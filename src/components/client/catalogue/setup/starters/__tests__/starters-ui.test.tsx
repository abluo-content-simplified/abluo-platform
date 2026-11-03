// @vitest-environment jsdom
/**
 * Starter Structures and the food-and-drink setup with the pack actions mocked (R2-D): the preview
 * follows the selection (channels never on unless ticked, hours declinable, untick / rename / add),
 * apply sends the exact previewed fingerprint after a confirmation, a changed plan is shown again,
 * and the item wizard returns to the SAME draft with Food or drink still chosen — finishing or
 * abandoning. The real planner computes every preview (no hand-written plans).
 */
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { byName, click, mount, typeInto, type Mounted } from '@/components/app/ui/__tests__/intl-dom'
import { scanHandmade } from '@/lab/handmade'

vi.mock('next-intl', async () => {
  const u = await import('use-intl')
  return { ...u, NextIntlClientProvider: u.IntlProvider }
})
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>, useRouter: () => nav }))

const a = vi.hoisted(() => ({ loadStarterStructuresAction: vi.fn(), previewPackAction: vi.fn(), applyPackAction: vi.fn() }))
vi.mock('@/app/[locale]/(client)/[tenant]/catalogue/setup/starters/pack-actions', () => a)
vi.mock('@/app/[locale]/(client)/[tenant]/catalogue/setup/settings-actions', () => ({}))
vi.mock('@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions', () => ({}))

import { defaultSelection, planPack, type CatalogueState, type PackSelection } from '@/lib/modules/catalogue/packs/plan'
import { getPack } from '@/lib/modules/catalogue/packs/registry'
import type { StarterStructuresView } from '@/lib/modules/catalogue/packs/service'
import { StarterStructures } from '../StarterStructures'
import { FoodSetupFlow, foodSetupSteps } from '../../food/FoodSetupFlow'

const STATE: CatalogueState = {
  projectSlug: 'site-a',
  defaultLocale: 'en',
  locales: ['en', 'it'],
  categories: [{ key: 'dolci', label: { en: 'Desserts' }, parentKey: null, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null }],
  tags: [],
  channels: [],
  channelsUnmigrated: false,
  settings: { setupCompletedAt: null, publicSegment: null, publicSegmentHistory: [], publicName: {}, defaultItemProfile: null },
  collections: [],
  takenSlugs: [],
  optionLists: [],
  formatTemplates: [],
  pageFirstSegments: [],
  history: [],
  revisions: { project: 'p1', taxonomy: 't1', history: '' },
  raw: { categories: [], tags: [], serviceChannels: [], formatTemplates: [], collections: {} },
}
const NO_IMPACT = { itemsChanged: 0, formatsChanged: 0, shieldedByOverride: 0, byChannel: {} }

/** The mocked preview action runs the REAL planner on a fixed state. */
function previewWith(state: CatalogueState = STATE) {
  a.previewPackAction.mockImplementation(async ({ packId, selection }: { packId: string; selection: PackSelection }) => ({
    ok: true,
    preview: { plan: planPack(state, getPack(packId)!, selection), impact: NO_IMPACT, currency: 'EUR', otherCollections: [], existing: { categories: state.categories.map((c) => ({ key: c.key, label: c.label })), tags: [] } },
  }))
}

const VIEW: StarterStructuresView = { defaultLocale: 'en', locales: ['en', 'it'], packs: [], history: [], offers: [], setupCompletedAt: null, currency: 'EUR', interrupted: [] }

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as { showModal: () => void; close: () => void }
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never
  // The item wizard's import chain reaches the Sanity schema package, which probes CSS.supports at load.
  ;(globalThis as { CSS?: unknown }).CSS ??= { supports: () => false }
})
let m: Mounted | null = null
afterEach(() => {
  m?.unmount()
  m = null
  document.body.innerHTML = ''
})
beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset()
  nav.push.mockReset()
  nav.refresh.mockReset()
})
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
const body = () => document.body
const text = () => document.body.textContent ?? ''
const lastSelection = (): PackSelection => a.previewPackAction.mock.calls.at(-1)![0].selection
const checkbox = (label: string) => byName(body(), 'input[type="checkbox"]', label) as HTMLInputElement | null
const inDialog = (label: string) => [...body().querySelectorAll('dialog[open] button')].find((b) => b.textContent === label) ?? null

describe('Starter Structures', () => {
  it('lists the seven packs; Empty is hidden once a pack is recorded; history and the update offer are shown', async () => {
    m = mount(<StarterStructures projectSlug="site-a" initial={VIEW} backHref="/site-a/catalogue/setup" />)
    for (const name of ['Pizzeria', 'Traditional restaurant', 'Fine dining', 'Café and bar', 'Wine bar', 'Start empty', 'Bookshop']) expect(byName(body(), 'button', new RegExp(`^${name}`))).not.toBeNull()
    m.unmount()
    const withHistory: StarterStructuresView = { ...VIEW, history: [{ key: 'bookshop@1', id: 'bookshop', version: 1, appliedAt: '2026-06-01T10:00:00Z', legacy: false, added: { categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: ['publicSegment'] } }], offers: [{ id: 'bookshop', fromVersion: 1, toVersion: 3 }] }
    m = mount(<StarterStructures projectSlug="site-a" initial={withHistory} backHref="/site-a/catalogue/setup" />)
    expect(byName(body(), 'button', /^Start empty/)).toBeNull()
    expect(text()).toContain('Bookshop, version 1')
    expect(text()).toMatch(/Added on June 1, 2026/)
    expect(text()).toContain('A newer version of “Bookshop” is available (version 1 → 3).')
    previewWith()
    click(byName(body(), 'button', 'Review update'))
    await flush()
    expect(a.previewPackAction).toHaveBeenCalledWith(expect.objectContaining({ packId: 'bookshop', update: true }))
    expect(text()).toContain('Update “Bookshop” to version 3')
  })

  it('preview: delivery evening-only is shown, can be unticked or have its hours declined; the preview follows the selection', async () => {
    previewWith()
    m = mount(<StarterStructures projectSlug="site-a" initial={VIEW} backHref="/site-a/catalogue/setup" />)
    click(byName(body(), 'button', /^Pizzeria/))
    await flush()
    expect(lastSelection()).toEqual(defaultSelection(getPack('pizzeria')!))
    expect(text()).toContain('What “Pizzeria” adds')
    expect(text()).toContain('3 service channels, 15 categories, 5 tags, 1 menu, 5 sections, 2 option groups, and 3 formats')
    expect(text()).toContain('Available 18:00–23:00 every day')
    expect(text()).toContain('Prices stay in EUR. A starter structure never changes the currency.')
    click(checkbox('Use the suggested hours'))
    await flush()
    expect(lastSelection().channelRules).toBe('skip')
    click(checkbox('Delivery'))
    await flush()
    expect(lastSelection().acceptChannels).toEqual(['dine-in', 'takeaway'])
    expect(text()).toContain('2 service channels')
    // untick a whole branch
    click(checkbox('Add Beverages'))
    await flush()
    expect(lastSelection().exclude).toEqual(['category:beverages'])
    expect(checkbox('Add Beer')!.disabled).toBe(true)
  })

  it('a label match is a proposal: "Use yours" maps it, "Add anyway" keeps it', async () => {
    previewWith()
    m = mount(<StarterStructures projectSlug="site-a" initial={VIEW} backHref="/site-a/catalogue/setup" />)
    click(byName(body(), 'button', /^Pizzeria/))
    await flush()
    expect(text()).toContain('Looks like your “Desserts”.')
    click(byName(body(), 'button', 'Use yours'))
    await flush()
    expect(lastSelection().resolutions).toEqual({ 'category:desserts': { use: 'existing', key: 'dolci' } })
    expect(text()).toContain('Uses your “Desserts”.')
  })

  it('rename and add your own in the review', async () => {
    previewWith()
    m = mount(<StarterStructures projectSlug="site-a" initial={VIEW} backHref="/site-a/catalogue/setup" />)
    click(byName(body(), 'button', /^Pizzeria/))
    await flush()
    click(byName(body(), 'button', 'Rename Salads'))
    const field = body().querySelector('dialog[open] input[lang="en"]')
    typeInto(field, 'Insalatone')
    click(inDialog('Save'))
    await flush()
    expect(lastSelection().labels).toEqual({ 'category:salads': { en: 'Insalatone', it: 'Insalate' } })
    expect(text()).toContain('Insalatone')
    click(byName(body(), 'button', 'Add a category'))
    typeInto(body().querySelector('dialog[open] input[lang="en"]'), 'Focacce')
    click(inDialog('Add'))
    await flush()
    expect(lastSelection().extras?.categories).toEqual([{ key: 'focacce', label: { en: 'Focacce' }, parent: null }])
    expect(text()).toContain('Yours')
  })

  it('apply: a confirmation first, then the exact previewed fingerprint; success reloads the view', async () => {
    previewWith()
    a.applyPackAction.mockResolvedValue({ ok: true, record: { _key: 'pizzeria@3' } })
    a.loadStarterStructuresAction.mockResolvedValue({ ok: true, view: { ...VIEW, history: [{ key: 'pizzeria@3', id: 'pizzeria', version: 3, appliedAt: '2026-11-03T10:00:00Z', legacy: false, added: { categories: ['pizza'], tags: [], collections: ['menu'], sections: [], optionGroups: [], channels: [], formats: [], settings: [] } }] } })
    m = mount(<StarterStructures projectSlug="site-a" initial={VIEW} backHref="/site-a/catalogue/setup" />)
    click(byName(body(), 'button', /^Pizzeria/))
    await flush()
    click(byName(body(), 'button', 'Add to my Catalogue'))
    expect(a.applyPackAction).not.toHaveBeenCalled()
    expect(text()).toContain('Add “Pizzeria”?')
    const fingerprint = planPack(STATE, getPack('pizzeria')!, defaultSelection(getPack('pizzeria')!)).fingerprint
    click(inDialog('Add to my Catalogue'))
    await flush()
    expect(a.applyPackAction).toHaveBeenCalledWith({ projectSlug: 'site-a', packId: 'pizzeria', version: 3, selection: defaultSelection(getPack('pizzeria')!), planFingerprint: fingerprint, update: false })
    await flush()
    expect(text()).toContain('“Pizzeria” was added. You can change everything in Setup.')
    expect(text()).toContain('Pizzeria, version 3')
  })

  it('a changed plan is shown again with a calm explanation; a blocked plan disables Apply and says why', async () => {
    previewWith({ ...STATE, pageFirstSegments: ['menu'] })
    m = mount(<StarterStructures projectSlug="site-a" initial={VIEW} backHref="/site-a/catalogue/setup" />)
    click(byName(body(), 'button', /^Pizzeria/))
    await flush()
    const apply = byName(body(), 'button', 'Add to my Catalogue') as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect(text()).toContain('Fix the points above first.')
    expect(text()).toContain('The web address /menu can’t be used')
    click(checkbox('Web address: /menu'))
    await flush()
    expect((byName(body(), 'button', 'Add to my Catalogue') as HTMLButtonElement).disabled).toBe(false)
    a.applyPackAction.mockResolvedValue({ ok: false, error: 'pack_plan_changed', detail: { plan: planPack({ ...STATE, revisions: { project: 'p2', taxonomy: 't1', history: '' } }, getPack('pizzeria')!, lastSelection()) } })
    click(byName(body(), 'button', 'Add to my Catalogue'))
    click(inDialog('Add to my Catalogue'))
    await flush()
    expect(text()).toContain('Something changed in the meantime. This is the updated preview: check it and add again.')
  })
})

describe('Food-and-drink setup flow', () => {
  it('five steps for a restaurant starter, two for Empty', () => {
    expect(foodSetupSteps('pizzeria')).toEqual(['starter', 'channels', 'review', 'availability', 'summary'])
    expect(foodSetupSteps('empty')).toEqual(['starter', 'summary'])
  })

  it('walks the steps and creates: Next says why it is off; summary counts; Set up now applies the previewed plan', async () => {
    previewWith()
    a.applyPackAction.mockResolvedValue({ ok: true, record: {} })
    const onDone = vi.fn()
    m = mount(<FoodSetupFlow open projectSlug="site-a" defaultLocale="en" locales={['en', 'it']} onDone={onDone} onExit={() => {}} />)
    expect((byName(body(), 'button', 'Next') as HTMLButtonElement).disabled).toBe(true)
    expect(text()).toContain('Choose where to start first.')
    expect(byName(body(), 'button', /^Bookshop/)).toBeNull()
    click(byName(body(), 'button', /^Café and bar/))
    await flush()
    click(byName(body(), 'button', 'Next'))
    expect(text()).toContain('How do people get your food and drink?')
    expect(checkbox('Delivery')!.checked).toBe(false) // suggestions need confirmation
    click(byName(body(), 'button', 'Next'))
    expect(text()).toContain('Categories, menus and options')
    click(byName(body(), 'button', 'Next'))
    expect(text()).toContain('When can each category be ordered?')
    expect(text()).toContain('Available 07:00–11:00 every day')
    click(checkbox('Use these hours for Cocktails on Takeaway'))
    await flush()
    expect(lastSelection().exclude).toEqual(['rule:cocktails:takeaway'])
    click(byName(body(), 'button', 'Next'))
    expect(text()).toContain('Ready to create')
    expect(text()).toContain('2 service channels, 9 categories, 4 tags, 2 menus, 7 sections, 2 option groups, and 5 formats')
    click(byName(body(), 'button', 'Set up now'))
    await flush()
    expect(a.applyPackAction).toHaveBeenCalledWith(expect.objectContaining({ packId: 'cafe-and-bar', planFingerprint: planPack(STATE, getPack('cafe-and-bar')!, lastSelection()).fingerprint }))
    expect(onDone).toHaveBeenCalledWith('pack')
  })

  it('Start empty applies Empty (setup complete, nothing added); Save and exit applies nothing', async () => {
    previewWith()
    a.applyPackAction.mockResolvedValue({ ok: true, record: {} })
    const onDone = vi.fn()
    const onExit = vi.fn()
    m = mount(<FoodSetupFlow open projectSlug="site-a" defaultLocale="en" locales={['en']} onDone={onDone} onExit={onExit} />)
    click(byName(body(), 'button', 'Save and exit'))
    expect(onExit).toHaveBeenCalled()
    expect(a.applyPackAction).not.toHaveBeenCalled()
    click(byName(body(), 'button', 'Start empty'))
    await flush()
    await flush()
    expect(a.applyPackAction).toHaveBeenCalledWith(expect.objectContaining({ packId: 'empty', version: 3 }))
    expect(onDone).toHaveBeenCalledWith('empty')
  })
})

describe('the hook in item creation', () => {
  vi.mock('@/components/client/catalogue/use-catalogue-draft', () => ({
    useCatalogueDraft: () => ({ id: '', created: false, changed: false, hasDraft: false, update: vi.fn(), publish: vi.fn(), setDates: vi.fn(), discardChanges: vi.fn(), flush: vi.fn(async () => true), state: 'idle', rejected: [], retry: vi.fn(), reload: vi.fn() }),
  }))
  vi.mock('@/components/client/media/use-media-uploads', () => ({ useUploadOwner: () => ({ inFlight: 0 }) }))

  const site = {
    defaultLocale: 'en',
    locales: ['en'],
    timeZone: 'Europe/Rome',
    amazonTrackingIds: [],
    awinPublisherId: null,
    affiliateShops: [],
    translate: false,
    config: { publicName: {}, segment: null, currency: 'EUR', channels: [], categories: [], tags: [], dietaryTags: [], defaultItemProfile: null, itemImageShape: null, serviceChannels: [], categoryNodes: [], migrations: {} },
  }

  async function wizard(foodSetup: { complete: boolean; canSetup: boolean }) {
    const { ItemWizard } = await import('../../../ItemWizard')
    m = mount(<ItemWizard projectSlug="site-a" site={site as never} optionLists={[]} listHref="/site-a/catalogue" foodSetup={foodSetup} />)
  }
  const foodCard = () => byName(body(), 'button', /^Food or drink/)

  it('choosing Food or drink when setup was never completed opens the setup above the draft; finishing returns to the same draft with Food still chosen', async () => {
    previewWith()
    a.applyPackAction.mockResolvedValue({ ok: true, record: {} })
    await wizard({ complete: false, canSetup: true })
    click(foodCard())
    await flush()
    expect(body().querySelector('dialog[open]')?.textContent).toContain('Set up food and drink')
    expect(foodCard()!.getAttribute('aria-checked')).toBe('true')
    click(byName(body(), 'button', 'Start empty'))
    await flush()
    await flush()
    expect(body().querySelector('dialog[open]')).toBeNull()
    expect(nav.refresh).toHaveBeenCalled()
    expect(text()).toContain('Setup is marked complete. You are back at your item.')
    // the wizard moved on to the name step of the same draft (nothing navigated away)
    expect(nav.push).not.toHaveBeenCalled()
    expect(body().querySelector('[data-name-locale="en"]')).not.toBeNull()
  })

  it('abandoning keeps the draft: Save and exit closes the setup, Food stays chosen, it can be reopened', async () => {
    previewWith()
    await wizard({ complete: false, canSetup: true })
    click(foodCard())
    await flush()
    click(byName(body(), 'button', 'Save and exit'))
    await flush()
    expect(body().querySelector('dialog[open]')).toBeNull()
    expect(a.applyPackAction).not.toHaveBeenCalled()
    expect(nav.push).not.toHaveBeenCalled()
    expect(foodCard()!.getAttribute('aria-checked')).toBe('true')
    expect(text()).toContain('Nothing was set up. Your item is still here.')
    click(byName(body(), 'button', 'Set up food and drink'))
    await flush()
    expect(body().querySelector('dialog[open]')).not.toBeNull()
  })

  it('setup already complete: Food or drink goes straight on; without the Setup permission a note explains', async () => {
    await wizard({ complete: true, canSetup: true })
    click(foodCard())
    await flush()
    expect(body().querySelector('dialog[open]')).toBeNull()
    expect(body().querySelector('[data-name-locale="en"]')).not.toBeNull()
    m!.unmount()
    m = null
    await wizard({ complete: false, canSetup: false })
    click(foodCard())
    await flush()
    expect(body().querySelector('dialog[open]')).toBeNull()
    expect(text()).toContain('Food and drink isn’t set up yet.')
  })
})

describe('no hand-made UI', () => {
  it('Starter Structures and the food setup use shared components only', () => {
    const found = scanHandmade(process.cwd())
    const mine = Object.entries(found).filter(([f]) => /catalogue\/setup\/(starters|food)\//.test(f))
    expect(mine).toEqual([])
  })
})
