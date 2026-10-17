// ADR-033 Amendment I (I-2) — the item profile registry.
//
// The ONLY place that knows the item profiles. No other file may contain the
// string 'foodOrDrink' or an `isFood` variable (guard: __tests__/profiles-guard.test.ts).
// Pure: no React, no I/O — importable from Studio schema, server, dashboard and
// public rendering. Callers ask what a profile CAN do (`can`) instead of which
// profile it is (ADR-031 D6).
//
// Slice 4b: `book` is selectable (in PROFILE_ORDER). An older deployment that
// reads a stored 'book' still maps it to 'product' through `profileOf`'s
// fallback, so adding it is additive.

export type ItemProfile = 'book' | 'foodOrDrink' | 'product' | 'service'

/** What a profile can carry. Allergens stay food-bound for legal reasons. */
export type Capability = 'bookDetails' | 'foodInformation' | 'pricing' | 'channelPricing' | 'options' | 'links'

/** default = shown and offered; onDemand = not offered by default, switchable per item (D7); off = never. */
export type Offering = 'default' | 'onDemand' | 'off'

export type ProfileDef = {
  id: ItemProfile
  /** English label for places without i18n (Studio list, admin module settings). */
  label: string
  /** Key into the dashboard icon set (`CAT_ICONS` in catalogue-ui). */
  icon: 'book' | 'food' | 'product' | 'service'
  /** i18n keys under `catalogue.dashboard.profile` (card label and one-line help). */
  labelKey: string
  descriptionKey: string
  nameLabelKey: 'name' | 'title'
  capabilities: Readonly<Record<Capability, Offering>>
  jsonLd: { itemPage: 'Book' | 'Product' | 'Service'; needsOffer: boolean }
}

const def = (d: ProfileDef): ProfileDef => Object.freeze({ ...d, capabilities: Object.freeze({ ...d.capabilities }), jsonLd: Object.freeze({ ...d.jsonLd }) })

export const PROFILES: Readonly<Record<ItemProfile, ProfileDef>> = Object.freeze({
  book: def({
    id: 'book',
    label: 'Book',
    icon: 'book',
    labelKey: 'book',
    descriptionKey: 'bookHelp',
    nameLabelKey: 'title',
    capabilities: { bookDetails: 'default', foodInformation: 'off', pricing: 'onDemand', channelPricing: 'onDemand', options: 'off', links: 'default' },
    jsonLd: { itemPage: 'Book', needsOffer: false },
  }),
  foodOrDrink: def({
    id: 'foodOrDrink',
    label: 'Food or drink',
    icon: 'food',
    labelKey: 'foodOrDrink',
    descriptionKey: 'foodOrDrinkHelp',
    nameLabelKey: 'name',
    capabilities: { bookDetails: 'off', foodInformation: 'default', pricing: 'default', channelPricing: 'default', options: 'default', links: 'onDemand' },
    jsonLd: { itemPage: 'Product', needsOffer: true },
  }),
  product: def({
    id: 'product',
    label: 'Product',
    icon: 'product',
    labelKey: 'product',
    descriptionKey: 'productHelp',
    nameLabelKey: 'name',
    // options: the amendment table says default; today's behaviour (D7) offers them only when
    // attached or the project has option lists — i.e. onDemand. 4a changes no behaviour.
    capabilities: { bookDetails: 'off', foodInformation: 'off', pricing: 'default', channelPricing: 'onDemand', options: 'onDemand', links: 'default' },
    jsonLd: { itemPage: 'Product', needsOffer: true },
  }),
  service: def({
    id: 'service',
    label: 'Service',
    icon: 'service',
    labelKey: 'service',
    descriptionKey: 'serviceHelp',
    nameLabelKey: 'name',
    capabilities: { bookDetails: 'off', foodInformation: 'off', pricing: 'default', channelPricing: 'default', options: 'onDemand', links: 'onDemand' },
    jsonLd: { itemPage: 'Service', needsOffer: false },
  }),
})

/** Selectable profiles, default order (presets reorder, never remove). */
export const PROFILE_ORDER: readonly ItemProfile[] = Object.freeze(['book', 'foodOrDrink', 'product', 'service'] as const)

export const isItemProfile = (v: unknown): v is ItemProfile => PROFILE_ORDER.includes(v as ItemProfile)

/** An unknown stored value becomes 'product' (today's safe fallback). */
export const profileOf = (v: unknown): ItemProfile => (isItemProfile(v) ? v : 'product')

export const offeringOf = (p: ItemProfile, c: Capability): Offering => PROFILES[p].capabilities[c]

/** offering !== 'off' */
export const can = (p: ItemProfile, c: Capability): boolean => offeringOf(p, c) !== 'off'

/** Selectable profiles that carry a capability — for GROQ filters and Studio. */
export const profilesWith = (c: Capability): ItemProfile[] => PROFILE_ORDER.filter((p) => can(p, c))

/**
 * GROQ condition "the item's profile carries food information". Byte-identical
 * to `itemProfile == "foodOrDrink"` while one profile does; parenthesised `||` if more ever do.
 */
export const FOOD_PROFILE_GROQ: string = (() => {
  const eq = profilesWith('foodInformation').map((p) => `itemProfile == "${p}"`)
  return eq.length === 1 ? eq[0] : `(${eq.join(' || ')})`
})()
