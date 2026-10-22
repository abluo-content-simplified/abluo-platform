// ── Catalogue — book editions (one buy link per language) ─────────────────────
//
// Pure, browser-safe. A buy link may carry an `edition`: the language of that
// edition and whether it is the original. Additive: a link without it is exactly
// what it was. The language is NOT limited to the site's languages (a Spanish
// edition on an English/Italian site is fine); it must be one of the codes below.

import type { CatalogueItemLinkDTO } from './dto'
import { looksLikeAmazon } from '@/lib/affiliate/amazon-links'
import { parseAwinUrl } from '@/lib/affiliate/awin-links'

/** Common edition languages, each named in its own language. Order = the editor's list. */
export const EDITION_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'no', name: 'Norsk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ro', name: 'Română' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'he', name: 'עברית' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
] as const

export type EditionLanguage = (typeof EDITION_LANGUAGES)[number]['code']

const NAMES: Record<string, string> = Object.fromEntries(EDITION_LANGUAGES.map((l) => [l.code, l.name]))

export const isEditionLanguage = (code: unknown): code is EditionLanguage => typeof code === 'string' && Object.prototype.hasOwnProperty.call(NAMES, code)

/** The language's own name ("Italiano"), or the code itself when unknown (never throws on odd stored data). */
export const editionLanguageName = (code: string): string => NAMES[code] ?? code

/** What a stored/typed edition looks like in the DTO and the editor. */
export type LinkEdition = { language: string; original: boolean }

/** Reads a stored edition leniently (read side): unknown shapes → undefined, so old/odd data renders as a plain link. */
export function readEdition(value: unknown): LinkEdition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as { language?: unknown; original?: unknown }
  if (typeof v.language !== 'string' || !/^[a-z]{2,3}$/.test(v.language)) return undefined
  return { language: v.language, original: v.original === true }
}

/**
 * Write-side validation of one link's `edition` (never trust the client). Returns the stored shape or null
 * for "no edition". Refuses: an edition on a non-buy link, a language outside the list, a non-boolean flag,
 * "original" without a language.
 */
export function cleanEdition(value: unknown, buy: boolean, fail: (message: string) => never): { language: string; original?: true } | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) fail('Bad edition.')
  const v = value as { language?: unknown; original?: unknown }
  if (v.original != null && typeof v.original !== 'boolean') fail('Bad edition.')
  if (v.language != null && typeof v.language !== 'string') fail('Choose a language from the list.')
  const language = typeof v.language === 'string' ? v.language.trim().toLowerCase() : ''
  if (!language) {
    if (v.original === true) fail('Choose the edition language first.')
    return null
  }
  if (!buy) fail('Editions belong on buy links.')
  if (!isEditionLanguage(language)) fail('Choose a language from the list.')
  return { language, ...(v.original === true ? { original: true as const } : {}) }
}

/**
 * True when the original edition is claimed for more than one LANGUAGE. Several shops selling the same
 * original edition (Amazon + IBS, both "Italiano · Original") are fine: they share one language.
 */
export const hasManyOriginals = (links: readonly { edition?: { language?: string; original?: boolean } | null }[]): boolean =>
  new Set(links.filter((l) => l.edition?.original === true).map((l) => l.edition!.language)).size > 1

/** The shop a buy-link address belongs to ('amazon', 'ibs', …), or null for any other address. Pure. */
export function shopOfUrl(url: string): { id: string; name: string } | null {
  const u = url.trim()
  if (!u) return null
  if (looksLikeAmazon(u)) return { id: 'amazon', name: 'Amazon' }
  // parseAwinUrl sees through a pasted Awin wrapper (awin1.com/cread.php?…&ued=<shop url>).
  const shop = parseAwinUrl(u)?.shop
  return shop ? { id: shop.id, name: shop.name } : null
}

type OriginalLink = { key: string; edition?: { language: string; original: boolean } | null }

/**
 * "Original" belongs to a language: every link of that language carries it, or none does. Applies a change
 * made on link `key` (its new edition; undefined = edition removed): ticking sets all links of the language
 * and unticks every other language; unticking unticks all of them. A link that BECOMES a language that
 * already is the original inherits it.
 */
export function applyEditionChange<T extends OriginalLink>(links: readonly T[], key: string, edition: { language: string; original: boolean } | undefined): T[] {
  if (!edition) return links.map((l) => (l.key === key ? { ...l, edition: undefined } : l))
  const old = links.find((l) => l.key === key)?.edition
  const languageChanged = !old || old.language !== edition.language
  const inherits = languageChanged && links.some((l) => l.key !== key && l.edition?.language === edition.language && l.edition.original)
  const original = inherits || edition.original
  return links.map((l) => {
    if (l.key === key) return { ...l, edition: { language: edition.language, original } }
    if (!l.edition) return l
    if (l.edition.language === edition.language) return { ...l, edition: { ...l.edition, original } }
    return original && l.edition.original ? { ...l, edition: { ...l.edition, original: false } } : l
  })
}

/** The shop that appears twice for the same edition language among these buy links, if any ("This edition already has a link to X"). */
export function duplicateEditionShop(links: readonly { key?: string; url: string; kind?: string; edition?: { language?: string } | null }[]): { index: number; shop: string } | null {
  const seen = new Set<string>()
  for (let i = 0; i < links.length; i++) {
    const l = links[i]
    if (l.kind !== 'buy' || !l.edition?.language) continue
    const shop = shopOfUrl(l.url)
    if (!shop) continue
    const k = `${l.edition.language}|${shop.id}`
    if (seen.has(k)) return { index: i, shop: shop.name }
    seen.add(k)
  }
  return null
}

type Ed = Pick<CatalogueItemLinkDTO, 'kind' | 'edition'>

/** Buy links that carry an edition. */
export const editionLinks = <T extends Ed>(links: readonly T[]): T[] => links.filter((l) => l.kind === 'buy' && !!l.edition)

/**
 * Display order of an item's buy links when it has editions: the visitor's page language first, then the
 * original, then the rest by language name; buy links without an edition follow, in stored order.
 * With fewer than two edition links the stored order is kept (nothing changes for old data).
 */
export function orderBuyLinks<T extends Ed>(links: readonly T[], locale?: string): T[] {
  const buy = links.filter((l) => l.kind === 'buy')
  if (editionLinks(buy).length < 2) return buy
  const rank = (l: T): number => {
    if (!l.edition) return 3
    if (locale && l.edition.language === locale) return 0
    if (l.edition.original) return 1
    return 2
  }
  return buy
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const d = rank(a.l) - rank(b.l)
      if (d) return d
      if (a.l.edition && b.l.edition) return editionLanguageName(a.l.edition.language).localeCompare(editionLanguageName(b.l.edition.language))
      return a.i - b.i
    })
    .map((x) => x.l)
}

/** Button text of an edition: "Italiano" or "English · Original". `originalWord` is the localized "Original". */
export const editionLabel = (edition: LinkEdition, originalWord: string): string =>
  edition.original && originalWord ? `${editionLanguageName(edition.language)} · ${originalWord}` : editionLanguageName(edition.language)
