// ── Digital Cards — the public website (ADR-049 D5, D6, D7, D9) ───────────────
//
// Pure: the route decisions of the /link pages and the vCard routes, and the
// VIEW MODEL a card renders from. No React, no Next, no Sanity client — the
// pages fetch (queries.ts) and hand the results in; everything here is
// unit-tested (__tests__/website.test.ts).
//
// The view model is where the D9 rule is enforced: contact values (phone,
// e-mail, WhatsApp, and the tel:/mailto:/wa.me hrefs built from them) leave
// this file ONLY as encodeContact() strings. The client components decode them
// in the browser. The switches are applied here too (resolveShow), so a
// component can render everything it is given.

import { safeLinkHref } from '@/lib/links/safe-href'
import { whatsappDigits } from '@/lib/forms/whatsapp'
import { contactLink, orderedContacts } from '@/components/people/contacts'
import { getPeopleMessages } from '@/lib/i18n/people-messages'
import { cleanProfileSegment, cleanProfileSegments, personHref } from '@/lib/modules/people/website'
import type { PersonPublic } from '@/lib/modules/people/projection'
import type { DigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { formatDigitalCardSiteMessage } from '@/lib/i18n/digital-cards-site-messages'
import { canonicalOrigin } from '@/lib/seo/canonical'
import { logoImageUrl } from '@/lib/sanity/image'
import { socialPlatformLabel } from '@/lib/settings/social-links'
import { isRenderableNavLink, resolveNavLink, NAV_INTERNAL_PAGES, NAV_INTERNAL_PAGE_MODULE, type NavInternalPage } from '@/lib/sanity/nav-links'
import type { NavLink, SupportedLocale } from '@/lib/sanity/types'
import {
  DIGITAL_CARD_PERSON_SOCIAL_KINDS,
  DIGITAL_CARD_SEGMENT,
  DIGITAL_CARD_SOURCE_PATTERN,
  DIGITAL_CARDS_MODULE_ID,
  cardPath,
  cardSiteLocations,
  encodeContact,
  isValidUrlName,
  qrTarget,
  resolveShow,
  slugifyUrlName,
  type DigitalCardLinkKind,
  type VCardInput,
} from './model'
import {
  DIGITAL_CARD_BY_RETIRED_NAME_QUERY,
  DIGITAL_CARD_PERSON_QUERY,
  DIGITAL_CARD_ROUTE_STATE_QUERY,
  DIGITAL_CARD_SITE_QUERY,
} from './queries'
import type {
  DigitalCardImage,
  DigitalCardProjectPublic,
  DigitalCardLinkLogo,
  DigitalCardLinkPublic,
  DigitalCardPersonResult,
  DigitalCardRetiredResult,
  DigitalCardRouteState,
  DigitalCardSiteResult,
} from './projection'

const RESERVATIONS_MODULE_ID = 'reservations'
const PEOPLE_MODULE_ID = 'people'

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `${siteBase}/link` — siteBase is siteBasePath(locale, tenant, hostScoped). */
export function siteCardHref(siteBase: string): string {
  return `${siteBase.replace(/\/+$/, '')}/${DIGITAL_CARD_SEGMENT}`
}

/** `${siteBase}/link/<urlName>`. */
export function personCardHref(siteBase: string, urlName: string): string {
  return `${siteCardHref(siteBase)}/${urlName}`
}

/** The homepage: the site base itself (`/it`, `/it/hoffmann`). */
export function homeHref(siteBase: string): string {
  return siteBase || '/'
}

/** Keeps an allow-listed `?src=` tag across a redirect, so a QR scan of a renamed card still counts as `qr`. */
export function withSource(href: string, src: string | string[] | null | undefined): string {
  const s = typeof src === 'string' ? src.trim().toLowerCase() : ''
  return DIGITAL_CARD_SOURCE_PATTERN.test(s) ? `${href}?src=${s}` : href
}

// ── Route decisions (D6) ──────────────────────────────────────────────────────

export type CardRouteOutcome<C> =
  | { kind: 'render'; card: C }
  | { kind: 'redirect'; to: string; permanent: boolean }
  | { kind: 'not-found' }

/** Module gate (D1): the project's enabled module ids must contain `digital-cards`. Unresolved → closed. */
export function isDigitalCardsModuleOn(enabledModuleIds: readonly string[] | null | undefined): boolean {
  return Array.isArray(enabledModuleIds) && enabledModuleIds.includes(DIGITAL_CARDS_MODULE_ID)
}

/**
 * /link. Live site card → render. A site card that exists but is offline
 * (unpublished / archived) → the homepage (temporary). No site card → 404.
 */
export function siteCardOutcome(input: {
  moduleOn: boolean
  card: DigitalCardSiteResult | null | undefined
  state: DigitalCardRouteState | null | undefined
  siteBase: string
}): CardRouteOutcome<DigitalCardSiteResult> {
  if (!input.moduleOn) return { kind: 'not-found' }
  if (input.card) return { kind: 'render', card: input.card }
  if (input.state && !input.state.live) return { kind: 'redirect', to: homeHref(input.siteBase), permanent: false }
  return { kind: 'not-found' }
}

/**
 * /link/<name>, in the order of queries.ts:
 *   1. live card by its current name → render; its person gone / off /
 *      anonymised / archived → /link (temporary);
 *   2. a live card USED this name → 308 to its current name;
 *   3. a card with this name exists but is offline → /link (temporary);
 *   4. 404.
 */
export function personCardOutcome(input: {
  moduleOn: boolean
  urlName: string
  card: DigitalCardPersonResult | null | undefined
  retired: DigitalCardRetiredResult | null | undefined
  state: DigitalCardRouteState | null | undefined
  siteBase: string
}): CardRouteOutcome<DigitalCardPersonResult & { person: PersonPublic }> {
  if (!input.moduleOn || !isValidUrlName(input.urlName)) return { kind: 'not-found' }
  const toSiteCard = { kind: 'redirect', to: siteCardHref(input.siteBase), permanent: false } as const
  if (input.card) {
    if (!input.card.person) return toSiteCard
    return { kind: 'render', card: input.card as DigitalCardPersonResult & { person: PersonPublic } }
  }
  if (input.retired?.urlName && isValidUrlName(input.retired.urlName) && input.retired.urlName !== input.urlName) {
    return { kind: 'redirect', to: personCardHref(input.siteBase, input.retired.urlName), permanent: true }
  }
  if (input.state && !input.state.live) return toSiteCard
  return { kind: 'not-found' }
}

/** The fetch the loaders use (fetchForTenant binds $projectSlug). */
export type CardFetch = <T>(query: string, params: Record<string, unknown>) => Promise<T>

interface LoadParams {
  locale: string
  defaultLocale: string
  /** getEnabledModuleIds(projectModuleConfigQuery result). */
  enabledModuleIds: readonly string[] | null | undefined
  siteBase: string
}

/** /link: reads only what the decision needs, in order. */
export async function loadSiteCard(fetch: CardFetch, p: LoadParams): Promise<CardRouteOutcome<DigitalCardSiteResult>> {
  const moduleOn = isDigitalCardsModuleOn(p.enabledModuleIds)
  if (!moduleOn) return { kind: 'not-found' }
  const params = { locale: p.locale, defaultLocale: p.defaultLocale }
  const card = await fetch<DigitalCardSiteResult | null>(DIGITAL_CARD_SITE_QUERY, params)
  const state = card ? null : await fetch<DigitalCardRouteState | null>(DIGITAL_CARD_ROUTE_STATE_QUERY, { ...params, kind: 'site', urlName: '' })
  return siteCardOutcome({ moduleOn, card, state, siteBase: p.siteBase })
}

/** /link/<name>: live card → retired name → offline card → 404 (queries.ts order). */
export async function loadPersonCard(
  fetch: CardFetch,
  p: LoadParams & { urlName: string },
): Promise<CardRouteOutcome<DigitalCardPersonResult & { person: PersonPublic }>> {
  const moduleOn = isDigitalCardsModuleOn(p.enabledModuleIds)
  if (!moduleOn || !isValidUrlName(p.urlName)) return { kind: 'not-found' }
  const params = { locale: p.locale, defaultLocale: p.defaultLocale, urlName: p.urlName }
  const card = await fetch<DigitalCardPersonResult | null>(DIGITAL_CARD_PERSON_QUERY, params)
  const retired = card ? null : await fetch<DigitalCardRetiredResult | null>(DIGITAL_CARD_BY_RETIRED_NAME_QUERY, params)
  const state =
    card || retired ? null : await fetch<DigitalCardRouteState | null>(DIGITAL_CARD_ROUTE_STATE_QUERY, { ...params, kind: 'person' })
  return personCardOutcome({ moduleOn, urlName: p.urlName, card, retired, state, siteBase: p.siteBase })
}

// ── View model ────────────────────────────────────────────────────────────────

export interface CardImageView {
  image: DigitalCardImage
  alt: string
}

/** A contact row: everything that could be scraped is encoded (D9). */
export interface CardContactView {
  kind: 'phone' | 'email' | 'whatsapp'
  /** Visible name of the row ("Phone"). */
  label: string
  /** encodeContact(the value shown). */
  textEnc: string
  /** encodeContact(tel: / mailto: / https://wa.me/…). */
  hrefEnc: string
}

/** A link's logo ready to render (Amendment A, 10): 24 px high, up to 48 px wide, contained, on a neutral tile; decorative. */
export interface CardLinkLogoView {
  src: string
  /** The rendered width in px (≤ LOGO_MAX_WIDTH), from the image's proportions; undefined when unknown. */
  width?: number
}

/** Rendered logo box: height 24, width up to 48 (px). Source is requested at 3x the height. */
export const LOGO_HEIGHT = 24
export const LOGO_MAX_WIDTH = 48
export const LOGO_SOURCE_HEIGHT = LOGO_HEIGHT * 3

export interface CardLinkView {
  key: string
  kind: DigitalCardLinkKind
  label: string
  /** Optional one-liner shown under the label (described-by, not part of the name). */
  description?: string
  primary: boolean
  /** Plain href (url, page, form, booking, file). */
  href?: string
  /** encodeContact(href) for phone / email / WhatsApp links (D9). */
  hrefEnc?: string
  /** Opens in a new tab. */
  external: boolean
  /** Optional small logo at the start of the button (decorative). */
  logo?: CardLinkLogoView
}

export interface CardSocialView {
  key: string
  label: string
  href: string
  /** Icon registry name, when there is one. */
  icon: string
}

export interface CardLocationView {
  key: string
  name: string | null
  lines: string[]
  mapsUrl: string | null
}

export interface CardView {
  kind: 'site' | 'person'
  publicId: string
  /** The heading: business name (site card) or the person's name. */
  name: string | null
  /** Person card: the job title. */
  role: string | null
  description: string | null
  /** Site card: the logo (dark + light versions). Person card: the photo. */
  logo: { dark: CardImageView; light: CardImageView | null } | null
  photo: CardImageView | null
  /** Person card: the business name, linking to the site card when it is live. */
  business: { name: string; href: string | null } | null
  primary: CardLinkView | null
  links: CardLinkView[]
  contacts: CardContactView[]
  socials: CardSocialView[]
  locations: CardLocationView[]
  /** Relative href of contact.vcf, or null when Save contact is off / there is nothing to save. */
  saveContactHref: string | null
  /** Person card: "More about …" → the People profile page. */
  profile: { href: string; label: string } | null
  background: DigitalCardImage | null
  /**
   * "Show QR code" (Amendment A): what the code encodes — the card's canonical
   * address (ADR-034) + `?src=qr` — and the address shown with it. null while
   * the site has no domain of its own (a preview host is never printed).
   */
  qr: { url: string; address: string } | null
}

/** The card's QR target on the canonical host, or null without a custom domain. */
export function cardQr(card: { kind: 'site' | 'person'; urlName?: string | null; project?: { customDomain?: string | null } | null }): CardView['qr'] {
  const origin = canonicalOrigin(card.project?.customDomain ?? null)
  if (!origin) return null
  const path = cardPath(card.kind, card.kind === 'person' ? card.urlName : null)
  if (card.kind === 'person' && path === `/${DIGITAL_CARD_SEGMENT}`) return null
  return { url: qrTarget(origin, path), address: `${origin.replace(/^https:\/\//, '')}${path}` }
}

export interface CardViewContext {
  locale: string
  siteBase: string
  messages: DigitalCardSiteMessages
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const orNull = (v: unknown): string | null => text(v) || null
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/

/** tel: href of a phone value, or null when it is not a plausible number. */
export function phoneHref(value: unknown): string | null {
  const v = text(value)
  const digits = v.replace(/[^\d]/g, '')
  if (digits.length < 5 || digits.length > 15) return null
  return `tel:${v.startsWith('+') || v.startsWith('00') ? '+' : ''}${v.startsWith('00') ? digits.slice(2) : digits}`
}

export function emailHref(value: unknown): string | null {
  const v = text(value)
  return EMAIL_RE.test(v) ? `mailto:${v}` : null
}

export function whatsappHref(value: unknown): string | null {
  const digits = whatsappDigits(text(value))
  return digits.length >= 6 && digits.length <= 15 ? `https://wa.me/${digits}` : null
}

const CONTACT_HREF = { phone: phoneHref, email: emailHref, whatsapp: whatsappHref } as const

function contactRow(kind: CardContactView['kind'], value: unknown, label: string): CardContactView | null {
  const href = CONTACT_HREF[kind](value)
  if (!href) return null
  return { kind, label, textEnc: encodeContact(text(value)), hrefEnc: encodeContact(href) }
}

/** A site-relative page href: the home page is the site base, any other page `${siteBase}/${slug}`. */
export function pageHref(page: DigitalCardLinkPublic['page'], siteBase: string): string | null {
  if (!page) return null
  if (page.pageType === 'home') return homeHref(siteBase)
  const slug = text(page.slug).replace(/^\/+|\/+$/g, '')
  if (!slug) return null
  return `${siteBase.replace(/\/+$/, '')}/${slug}`
}

// ── "Page on this website" links (Amendment B) ───────────────────────────────

/** The visible name of a built-in section in the visitor's language (the site dictionary); null when unknown. */
export function cardSectionLabel(section: string | null | undefined, m: DigitalCardSiteMessages): string | null {
  switch (section) {
    case 'homepage':
      return m.sectionHome
    case 'blog':
      return m.sectionBlog
    case 'news':
      return m.sectionNews
    case 'events':
      return m.sectionEvents
    case 'live':
      return m.sectionLive
    default:
      return null
  }
}

/** The visible name of a module's public page; null when unknown. */
export function cardModuleLabel(moduleId: string | null | undefined, m: DigitalCardSiteMessages): string | null {
  return moduleId === 'catalogue' ? m.sectionCatalogue : null
}

/** Is this built-in section on the website now (its module installed and on; the home page always)? */
export function cardSectionAvailable(section: string | null | undefined, enabledModules: readonly string[]): section is NavInternalPage {
  if (!section || !(NAV_INTERNAL_PAGES as readonly string[]).includes(section)) return false
  const mod = NAV_INTERNAL_PAGE_MODULE[section as NavInternalPage]
  return mod === null || enabledModules.includes(mod)
}

/**
 * A `page` link as the navigation's link-target model (NavLink), so it is
 * resolved by nav-links.ts exactly like a menu link: a page by its slug (the
 * home page as the home section, as before), a catalogue landing page /
 * collection / item through catalogueTarget (ADR-033 Amendment G), a built-in
 * section by internalPage, a module page by its installation's segment.
 * null when no target is chosen, or a section whose module is off.
 */
export function cardPageNavLink(
  link: Pick<DigitalCardLinkPublic, 'page' | 'hasPageRef' | 'catalogue' | 'internalPage' | 'moduleId'>,
  project: { enabledModules?: readonly string[] | null; moduleSegments?: DigitalCardProjectPublic['moduleSegments'] } | null | undefined,
): NavLink | null {
  const label = ''
  if (link.page) {
    if (link.page.pageType === 'home') return { label, linkType: 'internal', internalPage: 'homepage' }
    return { label, linkType: 'internal', pageSlug: text(link.page.slug).replace(/^\/+|\/+$/g, '') || undefined, hasPageRef: true, pageAccess: link.page.access ?? null }
  }
  if (link.catalogue || link.hasPageRef) return { label, linkType: 'internal', hasPageRef: true, catalogueTarget: link.catalogue ?? null }
  if (link.internalPage) {
    return cardSectionAvailable(link.internalPage, project?.enabledModules ?? []) ? { label, linkType: 'internal', internalPage: link.internalPage } : null
  }
  if (link.moduleId) return { label, linkType: 'module', moduleId: link.moduleId, moduleSegments: project?.moduleSegments ?? [] }
  return null
}

const NAV_TENANT = '_card'

/**
 * The href of a navigation link on the card: resolved by resolveNavLink() and
 * re-based from `/{locale}/{tenant}` onto the card's site base — which is
 * siteBasePath(locale, tenant, hostScoped), the same base toPublicNavLink()
 * produces (`/it/hoffmann/x` on a path-based surface, `/it/x` on the site's own
 * host). null when the nav would leave the link out (isRenderableNavLink).
 */
export function cardNavHref(nav: NavLink | null, locale: string, siteBase: string): string | null {
  if (!nav || !isRenderableNavLink(nav)) return null
  const href = resolveNavLink(nav, locale as SupportedLocale, NAV_TENANT).href
  const prefix = `/${locale}/${NAV_TENANT}`
  if (href !== prefix && !href.startsWith(`${prefix}/`) && !href.startsWith(`${prefix}#`)) return null
  const rest = href.slice(prefix.length)
  return rest && rest !== '/' ? `${siteBase.replace(/\/+$/, '')}${rest}` : homeHref(siteBase)
}

/** The title a `page` link shows when it has no label: the page's, the catalogue target's, the section's or module page's name. */
export function cardPageTargetTitle(
  link: Pick<DigitalCardLinkPublic, 'page' | 'catalogue' | 'internalPage' | 'moduleId'>,
  m: DigitalCardSiteMessages,
): string | null {
  if (link.page) return text(link.page.title) || null
  if (link.catalogue) return text(link.catalogue.title) || (link.catalogue.type === 'cataloguePage' ? m.sectionCatalogue : null)
  if (link.internalPage) return cardSectionLabel(link.internalPage, m)
  if (link.moduleId) return cardModuleLabel(link.moduleId, m)
  return null
}

/**
 * The label a link shows when none was typed for the language (D8): the page's
 * or file's title, else the standard label of the kind. One function for the
 * website card and the editor (the label field's placeholder and the links
 * list), so what the editor promises is what visitors see.
 */
export function linkDefaultLabel(kind: DigitalCardLinkKind, target: { pageTitle?: string | null; fileTitle?: string | null }, m: DigitalCardSiteMessages): string {
  switch (kind) {
    case 'url':
      return m.linkUrl
    case 'page':
      return text(target.pageTitle) || m.linkPage
    case 'form':
      return m.linkForm
    case 'booking':
      return m.linkBooking
    case 'file':
      return text(target.fileTitle) || m.linkFile
    case 'phone':
      return m.linkPhone
    case 'email':
      return m.linkEmail
    case 'whatsapp':
      return m.linkWhatsapp
    default:
      return m.linkUrl
  }
}

/**
 * A link's logo → its image URL: raster images through the image helper at 3x
 * the rendered height (72 px); SVG as stored (vector). null when there is no
 * usable image.
 */
export function cardLogoView(logo: DigitalCardLinkLogo | null | undefined): CardLinkLogoView | null {
  if (!logo) return null
  const url = text(logo.url)
  const svg = /svg/i.test(text(logo.mime)) || /\.svg(\?|$)/i.test(url)
  const src = svg ? (/^https:\/\//i.test(url) ? url : undefined) : logoImageUrl(logo.asset ? { asset: logo.asset } : undefined, LOGO_SOURCE_HEIGHT)
  if (!src) return null
  const w = Number(logo.dimensions?.width)
  const h = Number(logo.dimensions?.height)
  const width = w > 0 && h > 0 ? Math.min(LOGO_MAX_WIDTH, Math.max(1, Math.round((LOGO_HEIGHT * w) / h))) : undefined
  return { src, ...(width && { width }) }
}

/** What resolving a link needs besides the view context: the project's enabled modules and their public segments. */
export type CardLinkContext = CardViewContext & {
  enabledModules: readonly string[]
  moduleSegments?: DigitalCardProjectPublic['moduleSegments']
}

/** One shown link → what renders, or null when its target is missing / not allowed (D8). */
export function linkView(
  link: DigitalCardLinkPublic,
  ctx: CardLinkContext,
): CardLinkView | null {
  const view = linkViewBase(link, ctx)
  if (!view) return null
  const logo = cardLogoView(link.logo)
  return logo ? { ...view, logo } : view
}

function linkViewBase(
  link: DigitalCardLinkPublic,
  ctx: CardLinkContext,
): CardLinkView | null {
  if (!link || typeof link._key !== 'string' || !link._key) return null
  const m = ctx.messages
  const label = text(link.label)
  const description = text(link.description).replace(/\s+/g, ' ').trim()
  const base = { key: link._key, kind: link.kind, primary: link.primary === true, ...(description && { description }) }
  switch (link.kind) {
    case 'url': {
      const href = /^https?:\/\//i.test(text(link.url)) ? safeLinkHref(text(link.url)) : null
      return href ? { ...base, label: label || linkDefaultLabel('url', {}, m), href, external: true } : null
    }
    case 'page': {
      // Amendment B — resolved through the navigation's resolver (nav-links.ts).
      const href = cardNavHref(cardPageNavLink(link, { enabledModules: ctx.enabledModules, moduleSegments: ctx.moduleSegments }), ctx.locale, ctx.siteBase)
      if (!href) return null
      return { ...base, label: label || linkDefaultLabel('page', { pageTitle: cardPageTargetTitle(link, m) }, m), href, external: false }
    }
    case 'form':
    case 'booking': {
      if (link.kind === 'booking' && !ctx.enabledModules.includes(RESERVATIONS_MODULE_ID)) return null
      const href = pageHref(link.page, ctx.siteBase)
      if (!href) return null
      return { ...base, label: label || linkDefaultLabel(link.kind, { pageTitle: link.page?.title }, m), href, external: false }
    }
    case 'file': {
      const raw = text(link.file?.url)
      const href = /^https:\/\//i.test(raw) ? raw : null
      return href ? { ...base, label: label || linkDefaultLabel('file', { fileTitle: link.file?.title }, m), href, external: true } : null
    }
    case 'phone':
    case 'email':
    case 'whatsapp': {
      const href = CONTACT_HREF[link.kind](link.value)
      if (!href) return null
      return { ...base, label: label || linkDefaultLabel(link.kind, {}, m), hrefEnc: encodeContact(href), external: link.kind === 'whatsapp' }
    }
    default:
      return null
  }
}

/** The rendered links: the first shown Primary Action apart, the rest in order. */
export function linkViews(
  links: readonly DigitalCardLinkPublic[] | null | undefined,
  ctx: CardLinkContext,
): { primary: CardLinkView | null; links: CardLinkView[] } {
  const views = (links ?? []).map((l) => linkView(l, ctx)).filter((v): v is CardLinkView => v !== null)
  const primaryIndex = views.findIndex((v) => v.primary)
  if (primaryIndex < 0) return { primary: null, links: views }
  const primary = views[primaryIndex]
  return { primary, links: views.filter((_, i) => i !== primaryIndex).map((v) => ({ ...v, primary: false })) }
}


function personName(person: PersonPublic, mode: 'full' | 'first'): string | null {
  const first = text(person.firstName)
  if (mode === 'first' && first) return first
  return orNull(person.displayName) || orNull([first, text(person.lastName)].filter(Boolean).join(' '))
}

function firstOfKind(person: PersonPublic, kind: string) {
  return orderedContacts(person.contacts).find((c) => c.kind === kind && text(c.value)) ?? null
}

function locationLines(address: { street?: string | null; postalCode?: string | null; city?: string | null; state?: string | null; country?: string | null } | null | undefined): string[] {
  if (!address) return []
  const cityLine = [text(address.postalCode), text(address.city), text(address.state)].filter(Boolean).join(' ')
  return [text(address.street), cityLine, text(address.country)].filter(Boolean)
}

type SiteLocation = NonNullable<NonNullable<DigitalCardSiteResult['site']>['locations']>[number]

/** The site's locations — `locations[]`, or the single Website Settings address as one (key SITE_LOCATION_FALLBACK_KEY). */
export function siteLocations(site: DigitalCardSiteResult['site']): SiteLocation[] {
  return cardSiteLocations<SiteLocation>(site?.locations, site?.location, (address, key) => ({ _key: key, name: null, address, mapsUrl: null, shortName: null }))
}

/** The shown locations, in the order of the switches (the first one is the vCard address). */
function shownLocations(card: DigitalCardSiteResult, keys: readonly string[]) {
  const all = siteLocations(card.site)
  return keys
    .map((k) => all.find((l) => l?._key === k))
    .filter((l): l is NonNullable<typeof l> => !!l)
}

function imageView(image: DigitalCardImage | null | undefined, alt: string): CardImageView | null {
  return image?.asset ? { image, alt: text(image.alt) || alt } : null
}

/** The site card (D7): business data from Website Settings, filtered by the switches. */
export function siteCardView(card: DigitalCardSiteResult, ctx: CardViewContext): CardView {
  const site = card.site ?? {}
  const m = ctx.messages
  const socialsAvailable = (site.socialLinks ?? []).map((s) => s?.platform).filter((p): p is NonNullable<typeof p> => !!p)
  const locationsAvailable = siteLocations(site).map((l) => l?._key).filter((k): k is string => !!k)
  const show = resolveShow('site', card.show, { socials: socialsAvailable, locations: locationsAvailable })
  const siteName = orNull(site.siteName)
  const { primary, links } = linkViews(card.links, { ...ctx, enabledModules: card.project?.enabledModules ?? [], moduleSegments: card.project?.moduleSegments ?? null })

  const contacts = [
    show.phone ? contactRow('phone', site.phone, m.phone) : null,
    show.email ? contactRow('email', site.email, m.email) : null,
    show.whatsapp ? contactRow('whatsapp', site.whatsappNumber, m.whatsapp) : null,
  ].filter((c): c is CardContactView => c !== null)

  const socials: CardSocialView[] = (site.socialLinks ?? [])
    .filter((s) => s?.platform && show.socials.includes(s.platform))
    .map((s, i): CardSocialView | null => {
      const href = /^https?:\/\//i.test(text(s.url)) ? safeLinkHref(text(s.url)) : null
      return href ? { key: s._key ?? `${s.platform}-${i}`, label: socialPlatformLabel(s.platform), href, icon: s.platform } : null
    })
    .filter((s): s is CardSocialView => s !== null)

  const locations: CardLocationView[] = shownLocations(card, show.locations).map((l) => ({
    key: l._key,
    name: orNull(l.name),
    lines: locationLines(l.address),
    mapsUrl: /^https:\/\//i.test(text(l.mapsUrl)) ? safeLinkHref(text(l.mapsUrl)) : null,
  }))

  const logoDark = show.logo ? imageView(site.logo, siteName ?? '') : null
  const view: CardView = {
    kind: 'site',
    publicId: card.publicId,
    name: show.businessName ? siteName : null,
    role: null,
    description: show.description ? orNull(card.description) || orNull(site.tagline) : null,
    logo: logoDark ? { dark: logoDark, light: show.logo ? imageView(site.logoLight, siteName ?? '') : null } : null,
    photo: null,
    business: null,
    primary,
    links,
    contacts,
    socials,
    locations,
    saveContactHref: null,
    profile: null,
    background: card.background?.asset ? card.background : null,
    qr: cardQr(card),
  }
  view.saveContactHref = show.saveContact && vcardHasContent(siteVCardInput(card)) ? `${siteCardHref(ctx.siteBase)}/contact.vcf` : null
  return view
}

/** The person's profile page path, or null (People off, no page in this language, no segment). */
export function personProfileHref(card: DigitalCardPersonResult, person: PersonPublic, siteBase: string, locale: string): string | null {
  const enabled = card.project?.enabledModules ?? []
  if (!enabled.includes(PEOPLE_MODULE_ID)) return null
  const raw = card.project?.peopleProfileSegment
  const segment = typeof raw === 'string' ? cleanProfileSegment(raw) : (cleanProfileSegments(raw)[locale] ?? null)
  return personHref(person, { siteBase, segment })
}

/** The person card (D7): People public fields, filtered by the switches. */
export function personCardView(card: DigitalCardPersonResult & { person: PersonPublic }, ctx: CardViewContext): CardView {
  const person = card.person
  const m = ctx.messages
  const site = card.site ?? {}
  const socialContacts = orderedContacts(person.contacts).filter((c) => (DIGITAL_CARD_PERSON_SOCIAL_KINDS as readonly string[]).includes(c.kind))
  const show = resolveShow('person', card.show, { socials: socialContacts.map((c) => c._key) })
  const name = show.name ? personName(person, show.nameMode) : null
  const { primary, links } = linkViews(card.links, { ...ctx, enabledModules: card.project?.enabledModules ?? [], moduleSegments: card.project?.moduleSegments ?? null })

  const contacts = [
    show.phone ? contactRow('phone', firstOfKind(person, 'phone')?.value, m.phone) : null,
    show.email ? contactRow('email', firstOfKind(person, 'email')?.value, m.email) : null,
    show.whatsapp ? contactRow('whatsapp', firstOfKind(person, 'whatsapp')?.value, m.whatsapp) : null,
  ].filter((c): c is CardContactView => c !== null)

  const peopleMsg = getPeopleMessages(ctx.locale)
  const socials: CardSocialView[] = socialContacts
    .filter((c) => show.socials.includes(c._key))
    .map((c): CardSocialView | null => {
      const l = contactLink(c, peopleMsg)
      if (!l || l.type !== 'link') return null
      return { key: c._key, label: l.text, href: l.href, icon: c.kind === 'website' || c.kind === 'url' ? 'globe' : c.kind }
    })
    .filter((s): s is CardSocialView => s !== null)

  const siteName = orNull(site.siteName)
  const profileHref = show.profileLink ? personProfileHref(card, person, ctx.siteBase, ctx.locale) : null
  const shortName = text(person.firstName) || name || ''
  const view: CardView = {
    kind: 'person',
    publicId: card.publicId,
    name,
    role: show.role ? orNull(person.jobTitle) : null,
    description: show.description ? orNull(card.description) || orNull(person.shortBio) : null,
    logo: null,
    photo: show.photo ? imageView(person.photo, name ?? '') : null,
    business: show.businessName && siteName ? { name: siteName, href: card.siteCard ? siteCardHref(ctx.siteBase) : null } : null,
    primary,
    links,
    contacts,
    socials,
    locations: [],
    saveContactHref: null,
    profile: profileHref ? { href: profileHref, label: formatDigitalCardSiteMessage(m.moreAbout, { name: shortName }) } : null,
    background: card.background?.asset ? card.background : card.siteCard?.background?.asset ? card.siteCard.background : null,
    qr: cardQr(card),
  }
  view.saveContactHref =
    show.saveContact && vcardHasContent(personVCardInput(card)) ? `${personCardHref(ctx.siteBase, card.urlName)}/contact.vcf` : null
  return view
}

// ── Share preview (D9, D10): never contact data ──────────────────────────────

export interface CardShareMeta {
  title: string
  description: string | null
  /** The image to share (photo / background); null = keep the site's default. */
  image: DigitalCardImage | null
}

export function cardShareMeta(view: CardView, siteName: string | null | undefined, messages: DigitalCardSiteMessages): CardShareMeta {
  const site = text(siteName)
  const title =
    view.kind === 'person'
      ? [view.name, site].filter(Boolean).join(' · ') || formatDigitalCardSiteMessage(messages.ogFallbackTitle, { name: site })
      : view.name || site || formatDigitalCardSiteMessage(messages.ogFallbackTitle, { name: site })
  const description = view.kind === 'person' ? view.role || view.description : view.description
  const image = view.kind === 'person' ? (view.photo?.image ?? view.background) : view.background
  return { title, description: description ?? null, image: image?.asset ? image : null }
}

// ── vCard (D9): follows the switches ──────────────────────────────────────────

const decodeHrefValue = (href: string | null, prefix: string) => (href && href.startsWith(prefix) ? href.slice(prefix.length) : null)

/** True when a vCard would say more than a name. */
export function vcardHasContent(input: VCardInput): boolean {
  return Boolean(
    (input.phones ?? []).some((p) => text(p)) ||
      (input.emails ?? []).some((e) => text(e)) ||
      (input.urls ?? []).some((u) => text(u)) ||
      (input.address && Object.values(input.address).some((v) => text(v))),
  )
}

/** The site card's vCard: business name, shown phone / email, first shown location, the website. */
export function siteVCardInput(card: DigitalCardSiteResult, websiteUrl?: string | null): VCardInput {
  const site = card.site ?? {}
  const show = resolveShow('site', card.show, {
    socials: (site.socialLinks ?? []).map((s) => s?.platform).filter((p): p is NonNullable<typeof p> => !!p),
    locations: siteLocations(site).map((l) => l?._key).filter((k): k is string => !!k),
  })
  const first = shownLocations(card, show.locations)[0]
  return {
    fullName: orNull(site.siteName),
    org: orNull(site.siteName),
    phones: show.phone ? [decodeHrefValue(phoneHref(site.phone), 'tel:')] : [],
    emails: show.email ? [decodeHrefValue(emailHref(site.email), 'mailto:')] : [],
    address: first?.address ?? null,
    urls: websiteUrl ? [websiteUrl] : [],
  }
}

/** The person card's vCard: the shown name, role, business name, phone, email, website contacts. */
export function personVCardInput(card: DigitalCardPersonResult, websiteUrl?: string | null): VCardInput {
  const person = card.person
  if (!person) return {}
  const socialContacts = orderedContacts(person.contacts).filter((c) => (DIGITAL_CARD_PERSON_SOCIAL_KINDS as readonly string[]).includes(c.kind))
  const show = resolveShow('person', card.show, { socials: socialContacts.map((c) => c._key) })
  const peopleMsg = getPeopleMessages('en')
  const urls = socialContacts
    .filter((c) => show.socials.includes(c._key))
    .map((c) => contactLink(c, peopleMsg))
    .map((l) => (l && l.type === 'link' ? l.href : null))
  const first = text(person.firstName)
  const last = show.nameMode === 'first' ? '' : text(person.lastName)
  return {
    fullName: show.name ? personName(person, show.nameMode) : null,
    firstName: show.name ? first : null,
    lastName: show.name ? last : null,
    org: show.businessName ? orNull(card.site?.siteName) : null,
    title: show.role ? orNull(person.jobTitle) : null,
    phones: show.phone ? [decodeHrefValue(phoneHref(firstOfKind(person, 'phone')?.value), 'tel:')] : [],
    emails: show.email ? [decodeHrefValue(emailHref(firstOfKind(person, 'email')?.value), 'mailto:')] : [],
    urls: [...urls, ...(websiteUrl ? [websiteUrl] : [])],
  }
}

/** `<name>.vcf` — ASCII, never empty. */
export function vcardFileName(name: string | null | undefined): string {
  return `${slugifyUrlName(text(name)) || 'contact'}.vcf`
}

/** Bots / link-preview fetchers / scripts (vCard 403, hits ignored). */
const BOT_UA =
  /bot|crawl|spider|slurp|scrape|facebookexternalhit|facebot|embedly|preview|whatsapp\/|telegram|discord|skype|slack|vkshare|w3c_validator|curl|wget|python|httpclient|okhttp|go-http|java\/|axios|node-fetch|undici|headless|phantom|lighthouse|pingdom|uptime|monitor|check|scan|feed/i

export function isBotUserAgent(ua: string | null | undefined): boolean {
  const v = text(ua)
  return !v || v.length < 12 || BOT_UA.test(v)
}

export type VCardDecision = { kind: 'serve' } | { kind: 'not-found' } | { kind: 'forbidden' } | { kind: 'rate-limited' }

/**
 * The vCard route (CONTRACTS): bot → 403; module off, card offline / unknown,
 * person offline, Save contact off or nothing to save → 404; over the limit → 429.
 */
export function vcardDecision(input: {
  userAgent: string | null | undefined
  moduleOn: boolean
  /** The card's resolved Save contact switch, null = no live card. */
  saveContact: boolean | null
  hasContent: boolean
  withinRateLimit: boolean
}): VCardDecision {
  if (isBotUserAgent(input.userAgent)) return { kind: 'forbidden' }
  if (!input.moduleOn || input.saveContact !== true || !input.hasContent) return { kind: 'not-found' }
  if (!input.withinRateLimit) return { kind: 'rate-limited' }
  return { kind: 'serve' }
}

// ── A best-effort in-memory rate limit (per server instance, no IP) ───────────

export interface FixedWindowLimiter {
  /** Counts one request for `key`; false when the key is over its limit in the current window. */
  take(key: string, now?: number): boolean
}

/** Fixed-window counters keyed on what the caller passes (a card id — never an IP). Bounded memory. */
export function createFixedWindowLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): FixedWindowLimiter {
  const buckets = new Map<string, { start: number; count: number }>()
  const maxKeys = opts.maxKeys ?? 5000
  return {
    take(key, now = Date.now()) {
      const b = buckets.get(key)
      if (!b || now - b.start >= opts.windowMs) {
        if (!b && buckets.size >= maxKeys) {
          // Drop the oldest entries: a full map must never refuse new cards forever.
          for (const [k, v] of buckets) if (now - v.start >= opts.windowMs || buckets.size >= maxKeys) buckets.delete(k)
        }
        buckets.set(key, { start: now, count: 1 })
        return true
      }
      b.count += 1
      return b.count <= opts.limit
    },
  }
}
