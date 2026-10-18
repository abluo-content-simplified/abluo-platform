/**
 * Catalogue website texts — from messages/{locale}.json:
 *   catalogue.allergens.*  the fourteen Annex II labels (ADR-033 C3)
 *   catalogue.website.*    website chrome (Free, headings, option rules)
 *
 * Same pattern as src/lib/invitations/messages.ts. A site language without a
 * bundle, or a key missing from it, falls back to English per key; a key
 * missing everywhere renders empty rather than as its path. No user-facing
 * string is written in a component (CLAUDE.md, Localization).
 */
import en from '../../../messages/en.json'
import it from '../../../messages/it.json'
import de from '../../../messages/de.json'
import type { AllergenKey } from '@/lib/modules/catalogue/allergens'

type Dict = Record<string, unknown>

const BUNDLES: Record<string, Dict> = { en: en as Dict, it: it as Dict, de: de as Dict }

/** The website keys this module reads, under `catalogue.website`. */
export const CATALOGUE_WEBSITE_KEYS = [
  'free',
  'allergensHeading',
  'mayContainHeading',
  'containsHeading',
  'allergensNoneDeclared',
  'dietaryHeading',
  'tagsHeading',
  'optionsHeading',
  'pricesHeading',
  'chooseExactly',
  'chooseUpTo',
  'chooseAtLeast',
  'chooseBetween',
  'without',
  'linksHeading',
  'buyDefault',
  'affiliateMarker',
  'affiliateDisclosureDefault',
  // Amazon's required sentence (en/it/de in messages/*.json). The exact wording must be verified against
  // the tenant's Amazon Associates agreement; shown only when an Amazon affiliate link renders.
  'amazonStatement',
] as const

export type CatalogueWebsiteKey = (typeof CATALOGUE_WEBSITE_KEYS)[number]

export type CatalogueWebsiteMessages = Record<CatalogueWebsiteKey, string> & {
  allergen: (key: AllergenKey) => string
}

function pick(bundle: Dict | undefined, path: string[]): string | null {
  let v: unknown = bundle
  for (const p of path) {
    if (!v || typeof v !== 'object') return null
    v = (v as Dict)[p]
  }
  return typeof v === 'string' && v !== '' ? v : null
}

function lookup(locale: string, path: string[]): string {
  return pick(BUNDLES[locale], path) ?? pick(BUNDLES.en, path) ?? ''
}

export function getCatalogueWebsiteMessages(locale: string): CatalogueWebsiteMessages {
  const out = {} as Record<CatalogueWebsiteKey, string>
  for (const k of CATALOGUE_WEBSITE_KEYS) out[k] = lookup(locale, ['catalogue', 'website', k])
  return { ...out, allergen: (key) => lookup(locale, ['catalogue', 'allergens', key]) || key }
}

/** `{name}` placeholders, inserted verbatim (React escapes on render). */
export function fillMessage(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** The selection rule of an option list ("Choose up to 2"), or null when there is none. */
export function optionRuleText(m: CatalogueWebsiteMessages, min: number, max: number | null): string | null {
  if (max !== null && max > 0 && min === max) return fillMessage(m.chooseExactly, { min }) || null
  if (min > 0 && max !== null && max > min) return fillMessage(m.chooseBetween, { min, max }) || null
  if (min > 0) return fillMessage(m.chooseAtLeast, { min }) || null
  if (max !== null && max > 0) return fillMessage(m.chooseUpTo, { max }) || null
  return null
}
