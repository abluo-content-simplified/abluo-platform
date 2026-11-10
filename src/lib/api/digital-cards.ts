/**
 * Client dashboard — Digital Cards (ADR-049).
 *
 * Edits go to a DRAFT (`drafts.<id>`); only "Publish" changes the website.
 * Same enforcement as testimonials.ts / the lifecycle service:
 *   1. `assertModuleAction(ctx, projectId, digital-cards.*)` before any I/O;
 *      identity (`_id`, `_type`, `projectSlug`) comes from the GRANT.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `digitalCard`s of the grant's project — anything
 *      else is "not_found", so ids cannot be probed.
 *   3. Patch allow-list; every value is validated and rebuilt server-side
 *      (links, switches, background, URL name, description).
 *   4. `assertSingleSanityProject` right before every mutation; revision guards
 *      (`ifRevisionId` / transaction `ifRevisionID`) → "conflict".
 *   5. Opaque error codes (DigitalCardErrorCode).
 *   6. D2 — one site card per project (`site_exists`); one card per person
 *      (`person_has_card`). D5 — URL names unique per project across every
 *      card's current AND retired names (`url_name_taken`); publishing a
 *      renamed card retires the name that was live, so old links redirect.
 *   7. PUBLISH needs, for a person card, the person and a valid URL name, and
 *      at most one shown Primary Action; every shown link needs its target
 *      (`publish_blocked`, `detail.missing`).
 *   8. Unpublish / back online / archive / restore / delete go through the one
 *      lifecycle service (digital-cards-lifecycle.ts). Permanent delete is
 *      owner-only (digital-cards.delete).
 *   9. Statistics (Supabase, migration 068) only through readStats, behind
 *      digital-cards.stats.read, with the project slug FROM THE GRANT.
 *
 * Cards store switches only (D3): the site's and the person's data are READ
 * here to say which switches can be on ("availability"), never copied.
 */
import { randomUUID } from 'crypto'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { readStats as readStatsStore, statsRange, type DigitalCardStatsRead, type DigitalCardStatsStore } from '@/lib/api/digital-card-stats'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { DRAFT_SAVE } from '@/lib/sanity/draft-save'
import { audited, type ContentAuditWriter } from '@/lib/lifecycle/audit'
import * as lifecycle from '@/lib/lifecycle/service'
import { lifecycleAction, snapshotOf } from '@/lib/lifecycle/transition'
import { deriveStatus, type LifecycleStatus } from '@/lib/lifecycle/status'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { canonicalOrigin } from '@/lib/seo/canonical'
import { personDisplayName } from '@/lib/modules/people/model'
import { cardModuleLabel, cardSectionAvailable, cardSectionLabel } from '@/lib/modules/digital-cards/website'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { NAV_CATALOGUE_TARGET_FILTER } from '@/lib/modules/catalogue/nav-target-groq'
import {
  DIGITAL_CARD_LIMITS,
  DIGITAL_CARD_LINK_KINDS,
  DIGITAL_CARD_LINK_TARGET,
  DIGITAL_CARD_NAME_MODES,
  DIGITAL_CARD_PERSON_SOCIAL_KINDS,
  DIGITAL_CARD_STATS_RANGES,
  DIGITAL_CARD_TYPE,
  DIGITAL_CARD_LINK_TYPE,
  DIGITAL_CARD_MODULE_TARGETS,
  DIGITAL_CARD_PAGE_REF_TYPES,
  DIGITAL_CARD_SECTIONS,
  SITE_LOCATION_FALLBACK_KEY,
  cardModuleTargetId,
  cardSectionTargetId,
  cardAddressLine,
  cardPath,
  cardTextLength,
  cleanCardAddress,
  hasCardAddress,
  isValidUrlName,
  primaryLinkCount,
  resolveShow,
  suggestUrlName,
  takenUrlNames,
  type DigitalCardKind,
  type DigitalCardLinkKind,
  type DigitalCardShow,
} from '@/lib/modules/digital-cards/model'
import {
  DIGITAL_CARD_DELETE_PERMISSION,
  DIGITAL_CARD_LIFECYCLE,
  DIGITAL_CARD_READ_PERMISSION,
  DIGITAL_CARD_STATS_PERMISSION,
  DIGITAL_CARD_WRITE_PERMISSION,
  DigitalCardError,
  isDigitalCardId,
  type DigitalCardErrorCode,
  type DigitalCardMissing,
} from '@/lib/api/digital-cards-lifecycle'

export {
  DIGITAL_CARD_DELETE_PERMISSION,
  DIGITAL_CARD_READ_PERMISSION,
  DIGITAL_CARD_STATS_PERMISSION,
  DIGITAL_CARD_WRITE_PERMISSION,
  DigitalCardError,
  isDigitalCardId,
}
export type { DigitalCardErrorCode, DigitalCardMissing }

export type DigitalCardState = LifecycleStatus

/** languages[0] = the default language. */
export interface DigitalCardSite {
  defaultLocale: string
  languages: string[]
}

export interface DigitalCardListItem {
  /** Sanity document id (no `drafts.` prefix). */
  id: string
  publicId: string
  kind: DigitalCardKind
  /** The person's name ('' for the site card: the list shows the site name). */
  title: string
  personId: string | null
  /** A person card whose person is gone, off, anonymised or archived (offline on the website, D6). */
  personMissing: boolean
  urlName: string | null
  /** `/link` or `/link/<urlName>`. */
  path: string
  /** Shown links. */
  linkCount: number
  status: DigitalCardState
  hasChanges: boolean
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  updatedAt: string
  createdAt: string
}

/** A People person who can get a card (published, listable, no card yet). */
export interface DigitalCardPersonOption {
  id: string
  name: string
  jobTitle: string
}

export interface DigitalCardList {
  cards: DigitalCardListItem[]
  site: DigitalCardSite
  siteName: string
  hasSiteCard: boolean
  /** People without a card. */
  people: DigitalCardPersonOption[]
  /** https://www.<domain> (ADR-034), or null while the site has no domain. */
  origin: string | null
}

export interface DigitalCardImage {
  assetId: string
  url: string | null
  alt: Record<string, string>
}

export interface DigitalCardLinkValue {
  key: string
  kind: DigitalCardLinkKind
  label: Record<string, string>
  /** Optional one-liner under the label, per language (≤ DIGITAL_CARD_LIMITS.linkDescription). */
  description: Record<string, string>
  url: string
  /**
   * kind page / form / booking: the referenced document id. form / booking: a
   * `page`; page (Amendment B): a page, the catalogue landing page, a catalogue
   * collection or item — like navigationLink.pageRef.
   */
  page: string | null
  /** kind page only (Amendment B): a built-in section instead (homepage, blog, news, events, live). Absent = none. */
  internalPage?: string | null
  /** kind page only (Amendment B): an installed module's public page instead (e.g. catalogue). Absent = none. */
  moduleId?: string | null
  /** kind file: the Media Library asset id. */
  file: string | null
  /** Optional small logo shown on the button (Amendment A, 10): a Media Library image id. */
  logo: string | null
  /** kind phone / email / whatsapp. */
  value: string
  hidden: boolean
  primary: boolean
}

/** One target in the page picker. `id`: a document id, or `section:<internalPage>` / `module:<moduleId>` (cardLinkTargetFields). */
export interface DigitalCardTargetOption {
  id: string
  title: string
  /** Picker group; absent = pages. */
  group?: 'pages' | 'catalogue' | 'sections'
  /** What it is: page, cataloguePage, catalogueCollection, catalogueItem, section, module. Absent = page. */
  type?: string
  /** Site-relative path in the default language, for display ('' = home); absent when unknown. */
  path?: string
}

export interface DigitalCardOption {
  key: string
  label: string
  detail?: string
}

/** Which data exists, so a switch without data is disabled with a reason (D7). */
export interface DigitalCardAvailability {
  siteName: string
  logo: boolean
  businessName: boolean
  phone: boolean
  email: boolean
  whatsapp: boolean
  /**
   * The values themselves, so "What's on your card" shows the real number /
   * address (Amendment A). Site: Website Settings; person: the first PUBLIC
   * People contact of the kind (preferred first). '' = none.
   */
  values: { phone: string; email: string; whatsapp: string; role: string }
  /** Site: socialLinks by platform; person: People contacts by _key. */
  socials: DigitalCardOption[]
  /** Site card only: siteConfig.locations by _key — or, without any, the single `siteConfig.location` (key SITE_LOCATION_FALLBACK_KEY). */
  locations: DigitalCardOption[]
  /** Site card only: Studio's unpublished Website Settings draft has social profiles the website does not show yet. */
  socialsPendingInStudio: boolean
  /** Person card only. */
  photo: boolean
  role: boolean
  profilePage: boolean
  /** Booking links need the Reservations module. */
  reservations: boolean
}

export interface DigitalCardPersonInfo {
  id: string
  name: string
  firstName: string
  photoUrl: string | null
  /** Published, not off, not anonymised, not archived. */
  live: boolean
}

export interface DigitalCardSnapshot {
  id: string
  publicId: string
  /** The draft's revision; '' when no draft exists (call openDigitalCardForEdit). */
  rev: string
  hasDraft: boolean
  isPublished: boolean
  archivedAt: string | null
  status: DigitalCardState
  hasChanges: boolean
  kind: DigitalCardKind
  person: DigitalCardPersonInfo | null
  urlName: string
  /** The name the website answers on now (null = not published). */
  publishedUrlName: string | null
  retiredUrlNames: string[]
  description: Record<string, string>
  links: DigitalCardLinkValue[]
  background: DigitalCardImage | null
  /** Person card: the live site card's background, used while the card has none (D4). */
  inheritedBackground: DigitalCardImage | null
  /** Resolved switches (stored over the defaults). */
  show: DigitalCardShow
  availability: DigitalCardAvailability
  /**
   * What a page link can point at (Amendment B), in picker order: published
   * pages, then — while the Catalogue is on — its landing page, collections and
   * items with a page of their own, then the built-in sections and module pages
   * whose module is on. form / booking links use the `pages` group only.
   * Titles in the site's default language.
   */
  pages: DigitalCardTargetOption[]
  /** Files the links point at (asset id → name). */
  files: Record<string, { title: string; url: string | null }>
  site: DigitalCardSite
  origin: string | null
  path: string
  live: { rev: string } | null
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type DigitalCardDeps = {
  client?: Client
  now?: () => Date
  /** New ids (document id, then publicId). */
  uuid?: () => string
  audit?: ContentAuditWriter
  stats?: Pick<DigitalCardStatsStore, 'readStats'>
}

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields never copied between versions: publishing can never take a card off the website. */
const WINDOW_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RAW = { perspective: 'raw' } as const
const PATCH_BYTES = 64_000
const MAX_CARDS = 300
const PUBLISHED = `!(_id in path("drafts.**"))`

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new DigitalCardError('not_found', 'Unknown card.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === DIGITAL_CARD_TYPE && doc.projectSlug === projectSlug)
}

async function readPair(client: Client, id: string, projectSlug: string) {
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [Doc | undefined, Doc | undefined]
  if ((published && !ours(published, projectSlug)) || (draft && !ours(draft, projectSlug))) notFound()
  return { published, draft }
}

const singleProjectGuard = (client: Client, projectSlug: string) => assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)

async function commit(client: Client, projectSlug: string, run: () => Promise<unknown>, guard?: Promise<void>): Promise<unknown> {
  await (guard ?? singleProjectGuard(client, projectSlug))
  try {
    return await run()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new DigitalCardError('conflict', 'This card was changed elsewhere.')
    throw new DigitalCardError('failed', 'Could not save.')
  }
}

const objectOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
const refOf = (v: unknown): string | null => {
  const r = str(objectOf(v)?._ref)
  return r && DOC_ID.test(r) ? r : null
}

/** The per-language strings of a localized value (never `_type`, never `translationStatus`). */
function localized(value: unknown): Record<string, string> {
  const o = objectOf(value)
  if (!o) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && k !== 'translationStatus' && typeof v === 'string' && v.trim()) out[k] = v
  return out
}

const pickText = (value: unknown, preferred: readonly string[]): string => {
  if (typeof value === 'string') return value
  const v = localized(value)
  for (const l of preferred) if (v[l]) return v[l]
  return Object.values(v)[0] ?? ''
}

const archivedAtOf = (doc: Doc | undefined): string | null => (typeof doc?.archivedAt === 'string' && doc.archivedAt ? doc.archivedAt : null)
const kindOf = (doc: Doc | undefined): DigitalCardKind => (doc?.kind === 'person' ? 'person' : 'site')
const stateOf = (published: Doc | undefined, draft: Doc | undefined, now: Date) => deriveStatus({ published: snapshotOf(published), draft, rule: 'optional' }, now)
const publicIdOf = (doc: Doc | undefined): string => (typeof doc?.publicId === 'string' && UUID_RE.test(doc.publicId) ? doc.publicId : '')

// ── Site facts (Website Settings + project, D3) ───────────────────────────────

type SiteRow = {
  config?: {
    siteName?: unknown
    defaultLocale?: unknown
    supportedLocales?: unknown
    phone?: unknown
    email?: unknown
    whatsappNumber?: unknown
    hasLogo?: unknown
    socialLinks?: Array<{ _key?: unknown; platform?: unknown; url?: unknown }> | null
    locations?: Array<{ _key?: unknown; name?: unknown; shortName?: unknown; city?: unknown }> | null
    /** The single address (businessLocation) — the card's location when `locations[]` is empty. */
    location?: { street?: unknown; postalCode?: unknown; city?: unknown; state?: unknown; country?: unknown } | null
  } | null
  project?: { customDomain?: unknown; whatsappNumber?: unknown } | null
  /** Studio's unpublished Website Settings draft — its social profiles only (never shown on a card). */
  draftSocials?: Array<{ platform?: unknown; url?: unknown }> | null
}

const SITE_QUERY = /* groq */ `{
  "config": *[_type == "siteConfig" && projectSlug == $projectSlug && ${PUBLISHED}][0]{
    siteName, defaultLocale, supportedLocales, phone, email, whatsappNumber,
    "hasLogo": defined(logo.asset) || defined(logoLight.asset),
    socialLinks[]{ _key, platform, url },
    locations[]{ _key, name, shortName, "city": address.city },
    location{ street, postalCode, city, state, country }
  },
  "project": *[_type == "project" && projectSlug == $projectSlug && ${PUBLISHED}][0]{
    customDomain,
    "whatsappNumber": moduleInstallations[moduleId == "whatsapp" && enabled != false][0].config.whatsappNumber
  },
  "draftSocials": *[_type == "siteConfig" && projectSlug == $projectSlug && _id in path("drafts.**")][0].socialLinks[]{ platform, url }
}`

interface SiteFacts {
  site: DigitalCardSite
  siteName: string
  origin: string | null
  hasLogo: boolean
  phone: boolean
  email: boolean
  whatsapp: boolean
  values: DigitalCardAvailability['values']
  socials: DigitalCardOption[]
  locations: DigitalCardOption[]
  socialsPendingInStudio: boolean
}

/**
 * Does Studio's unpublished Website Settings draft hold a social profile the
 * published settings do not (Claudia Hoffmann, 2026-11-09: LinkedIn and
 * Facebook only in the draft)? The card shows what the website shows — the
 * published profiles — and the editor says that more are waiting.
 */
export function socialsPendingInStudio(published: DigitalCardOption[], draft: SiteRow['draftSocials']): boolean {
  const live = new Set(published.map((s) => `${s.key}|${(s.detail ?? '').trim()}`))
  return (draft ?? []).some((d) => {
    const platform = str(d?.platform).trim()
    const url = str(d?.url).trim()
    return Boolean(platform && url) && !live.has(`${platform}|${url}`)
  })
}

async function readSiteFacts(client: Client, projectSlug: string): Promise<SiteFacts> {
  // Raw perspective: the draft of Website Settings is read for `draftSocials` only; every other field is filtered to published.
  const row = (await client.fetch<SiteRow | null>(SITE_QUERY, { projectSlug }, RAW)) ?? {}
  const c = row.config ?? {}
  const locales = strings(c.supportedLocales)
  const defaultLocale = str(c.defaultLocale) || locales[0]
  if (!defaultLocale) throw new DigitalCardError('failed', 'Site languages are not configured.')
  const languages = [defaultLocale, ...locales.filter((l) => l !== defaultLocale)]
  const socials: DigitalCardOption[] = []
  for (const s of c.socialLinks ?? []) {
    const platform = str(s?.platform).trim()
    if (!platform || !str(s?.url).trim() || socials.some((x) => x.key === platform)) continue
    socials.push({ key: platform, label: platform, detail: str(s?.url) })
  }
  const locations: DigitalCardOption[] = []
  for (const l of c.locations ?? []) {
    const key = str(l?._key)
    if (!key) continue
    locations.push({ key, label: pickText(l?.name, languages) || str(l?.shortName) || str(l?.city) || key, ...(str(l?.city) && { detail: str(l?.city) }) })
  }
  // No locations[]: the single Website Settings address is the card's one location.
  if (!locations.length && hasCardAddress(c.location)) {
    const a = cleanCardAddress(c.location)
    locations.push({ key: SITE_LOCATION_FALLBACK_KEY, label: a.city || a.street || cardAddressLine(a), detail: cardAddressLine(a) })
  }
  return {
    site: { defaultLocale, languages },
    siteName: str(c.siteName).trim(),
    origin: canonicalOrigin(str(row.project?.customDomain) || null),
    hasLogo: c.hasLogo === true,
    phone: Boolean(str(c.phone).trim()),
    email: Boolean(str(c.email).trim()),
    whatsapp: Boolean(str(row.project?.whatsappNumber).trim() || str(c.whatsappNumber).trim()),
    values: {
      phone: str(c.phone).trim(),
      email: str(c.email).trim(),
      whatsapp: str(row.project?.whatsappNumber).trim() || str(c.whatsappNumber).trim(),
      role: '',
    },
    socials,
    locations,
    socialsPendingInStudio: socialsPendingInStudio(socials, row.draftSocials),
  }
}

// ── People (public fields only — never person_private) ────────────────────────

type PersonRow = {
  _id: string
  firstName?: unknown
  lastName?: unknown
  displayName?: unknown
  jobTitle?: unknown
  photoUrl?: unknown
  contacts?: Array<{ _key?: unknown; kind?: unknown; value?: unknown; label?: unknown; preferred?: unknown }> | null
  visibility?: unknown
  anonymised?: unknown
  archived?: unknown
  slug?: unknown
}

const PERSON_FIELDS = /* groq */ `_id, firstName, lastName, displayName, jobTitle,
  "photoUrl": select(photo->projectSlug == $projectSlug => photo->image.asset->url),
  contacts[]{ _key, kind, value, label, preferred },
  "visibility": coalesce(visibility, "listed"),
  "anonymised": defined(anonymisedAt),
  "archived": defined(archivedAt),
  slug`

const listable = (p: PersonRow | null | undefined) => Boolean(p && p.visibility !== 'off' && p.anonymised !== true && p.archived !== true)
const personName = (p: PersonRow | null | undefined) => personDisplayName(p ?? null)

async function readPeople(client: Client, projectSlug: string, ids: string[] | null): Promise<PersonRow[]> {
  const rows = await client.fetch<PersonRow[] | null>(
    `*[_type == "person" && projectSlug == $projectSlug && ${PUBLISHED}${ids ? ' && _id in $ids' : ''}] | order(lower(lastName) asc, lower(firstName) asc)[0...500]{ ${PERSON_FIELDS} }`,
    { projectSlug, ...(ids && { ids }) }
  )
  return Array.isArray(rows) ? rows : []
}

/** The person's usable public contacts, preferred ones first (the website's order, website.ts firstOfKind). */
const contactsOf = (p: PersonRow | null | undefined) => {
  const list = (p?.contacts ?? []).filter((c) => KEY_RE.test(str(c?._key)) && str(c?.value).trim()) as Array<{ _key: string; kind?: unknown; value: string; label?: unknown; preferred?: unknown }>
  return [...list.filter((c) => c.preferred === true), ...list.filter((c) => c.preferred !== true)]
}

function personAvailability(p: PersonRow | null | undefined, facts: SiteFacts, reservations: boolean): DigitalCardAvailability {
  const contacts = contactsOf(p)
  const has = (kind: string) => contacts.some((c) => c.kind === kind)
  const first = (kind: string) => contacts.find((c) => c.kind === kind)?.value.trim() ?? ''
  const slug = objectOf(p?.slug)
  const slugHere = str(objectOf(slug?.[facts.site.defaultLocale])?.current)
  return {
    siteName: facts.siteName,
    logo: false,
    businessName: Boolean(facts.siteName),
    phone: has('phone'),
    email: has('email'),
    whatsapp: has('whatsapp'),
    values: { phone: first('phone'), email: first('email'), whatsapp: first('whatsapp'), role: pickText(p?.jobTitle, facts.site.languages).trim() },
    socials: contacts
      .filter((c) => (DIGITAL_CARD_PERSON_SOCIAL_KINDS as readonly unknown[]).includes(c.kind))
      .map((c) => ({ key: c._key, label: str(c.label).trim() || str(c.kind), detail: c.value })),
    locations: [],
    socialsPendingInStudio: false,
    photo: Boolean(str(p?.photoUrl)),
    role: Boolean(pickText(p?.jobTitle, facts.site.languages).trim()),
    profilePage: p?.visibility === 'page' && Boolean(slugHere),
    reservations,
  }
}

function siteAvailability(facts: SiteFacts, reservations: boolean): DigitalCardAvailability {
  return {
    siteName: facts.siteName,
    logo: facts.hasLogo,
    businessName: Boolean(facts.siteName),
    phone: facts.phone,
    email: facts.email,
    whatsapp: facts.whatsapp,
    values: facts.values,
    socials: facts.socials,
    locations: facts.locations,
    socialsPendingInStudio: facts.socialsPendingInStudio,
    photo: false,
    role: false,
    profilePage: false,
    reservations,
  }
}

// ── The project's cards (every copy) ──────────────────────────────────────────

type CardRow = Doc & {
  kind?: unknown
  person?: unknown
  urlName?: unknown
  retiredUrlNames?: unknown
  links?: unknown
  _createdAt?: string
  _updatedAt?: string
}

const CARDS_QUERY = /* groq */ `*[_type == "${DIGITAL_CARD_TYPE}" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
  | order(_updatedAt desc)[0...${MAX_CARDS * 2}]{
    _id, _rev, _createdAt, _updatedAt, publicId, kind, person, urlName, retiredUrlNames, links, archivedAt, expiresAt, publishedAt }`

async function readCards(client: Client, projectSlug: string): Promise<CardRow[]> {
  const rows = await client.fetch<CardRow[] | null>(CARDS_QUERY, { projectSlug }, RAW)
  return (Array.isArray(rows) ? rows : []).filter((r) => typeof r._id === 'string')
}

const baseId = (id: string) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)

function groupCards(rows: CardRow[]) {
  const byId = new Map<string, { draft?: CardRow; published?: CardRow; createdAt: string }>()
  for (const row of rows) {
    const id = baseId(row._id!)
    if (!isDigitalCardId(id)) continue
    const entry = byId.get(id) ?? { createdAt: '' }
    if (row._createdAt && (!entry.createdAt || row._createdAt < entry.createdAt)) entry.createdAt = row._createdAt
    if (row._id!.startsWith('drafts.')) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  return byId
}

const shownLinks = (links: unknown) => (Array.isArray(links) ? links.filter((l) => objectOf(l) && (l as { hidden?: unknown }).hidden !== true).length : 0)

// ── List ──────────────────────────────────────────────────────────────────────

/** The project's cards: the site card first, then person cards by name. Read permission. */
export async function listDigitalCards(ctx: TenantAuthorizationContext, projectId: string, deps: DigitalCardDeps = {}): Promise<DigitalCardList> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const now = (deps.now ?? (() => new Date()))()
  const [facts, rows, people] = await readsInOrder<[SiteFacts, CardRow[], PersonRow[]]>([
    readSiteFacts(client, grant.projectSlug),
    readCards(client, grant.projectSlug),
    readPeople(client, grant.projectSlug, null),
  ])
  const peopleById = new Map(people.map((p) => [p._id, p]))
  const withCard = new Set<string>()
  const cards: DigitalCardListItem[] = []
  for (const [id, e] of groupCards(rows)) {
    const row = (e.draft ?? e.published)!
    const kind = kindOf(row)
    const personId = kind === 'person' ? refOf(row.person) : null
    for (const r of [e.draft, e.published]) {
      const p = r ? refOf(r.person) : null
      if (p) withCard.add(p)
    }
    const person = personId ? peopleById.get(personId) : undefined
    const state = stateOf(e.published, e.draft, now)
    const urlName = kind === 'person' && isValidUrlName(row.urlName) ? row.urlName : null
    cards.push({
      id,
      publicId: publicIdOf(row),
      kind,
      title: kind === 'person' ? personName(person) : '',
      personId,
      personMissing: kind === 'person' && !listable(person),
      urlName,
      path: cardPath(kind, urlName),
      linkCount: shownLinks(row.links),
      status: state.status,
      hasChanges: state.hasChanges,
      hasDraft: Boolean(e.draft),
      isPublished: Boolean(e.published),
      archivedAt: archivedAtOf(e.published ?? e.draft),
      updatedAt: row._updatedAt ?? '',
      createdAt: e.createdAt || row._updatedAt || '',
    })
  }
  // Site card first; then person cards by name, cards whose person is gone last.
  cards.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'site' ? -1 : 1) : Number(!a.title) - Number(!b.title) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)))
  return {
    cards,
    site: facts.site,
    siteName: facts.siteName,
    hasSiteCard: cards.some((c) => c.kind === 'site'),
    people: people
      .filter((p) => listable(p) && !withCard.has(p._id) && personName(p))
      .map((p) => ({ id: p._id, name: personName(p), jobTitle: pickText(p.jobTitle, facts.site.languages) })),
    origin: facts.origin,
  }
}

// ── Read one ──────────────────────────────────────────────────────────────────

function linksOf(value: unknown): DigitalCardLinkValue[] {
  if (!Array.isArray(value)) return []
  const out: DigitalCardLinkValue[] = []
  for (const raw of value) {
    const l = objectOf(raw)
    if (!l || !KEY_RE.test(str(l._key))) continue
    const kind = (DIGITAL_CARD_LINK_KINDS as readonly unknown[]).includes(l.kind) ? (l.kind as DigitalCardLinkKind) : 'url'
    out.push({
      key: str(l._key),
      kind,
      label: localized(l.label),
      description: localized(l.description),
      url: str(l.url),
      page: refOf(l.page),
      ...(kind === 'page' && !refOf(l.page) && str(l.internalPage) && { internalPage: str(l.internalPage) }),
      ...(kind === 'page' && !refOf(l.page) && !str(l.internalPage) && str(l.moduleId) && { moduleId: str(l.moduleId) }),
      file: refOf(l.file),
      logo: refOf(l.logo),
      value: str(l.value),
      hidden: l.hidden === true,
      primary: l.primary === true,
    })
  }
  return out
}

async function readImage(client: Client, assetId: string | null, projectSlug: string): Promise<DigitalCardImage | null> {
  if (!assetId) return null
  const row = await client.fetch<{ url?: unknown; alt?: unknown } | null>(
    `*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug][0]{ "url": image.asset->url, "alt": altText }`,
    { id: assetId, projectSlug }
  )
  if (!row) return null
  return { assetId, url: typeof row.url === 'string' ? row.url : null, alt: localized(row.alt) }
}

const CATALOGUE_TARGET_TYPES = DIGITAL_CARD_PAGE_REF_TYPES.filter((t) => t !== 'page')
const CATALOGUE_TYPE_ORDER: Record<string, number> = { cataloguePage: 0, catalogueCollection: 1, catalogueItem: 2 }

type TargetRows = {
  pages?: Array<{ _id?: unknown; title?: unknown; slug?: unknown; pageType?: unknown }> | null
  catalogue?: Array<{ _id?: unknown; _type?: unknown; title?: unknown; slug?: unknown }> | null
  modules?: Array<{ moduleId?: unknown; segment?: unknown }> | null
}

/**
 * What a page link can point at (Amendment B) — the navigation picker's reach
 * (navigationLink: pageRef, internalPage, module) on this website, titled in
 * the default language: published pages; while the Catalogue is on, its
 * landing page and the collections / items with a page of their own that the
 * website would link (NAV_CATALOGUE_TARGET_FILTER: this project's, public,
 * linkable by explicit reference); the built-in sections whose module is on
 * (the home section only when no Home page exists); and the module pages of
 * enabled modules with a public segment (the catalogue one only when it has no
 * landing page document — that one is offered instead).
 */
async function readLinkTargets(client: Client, projectSlug: string, defaultLocale: string, enabledModuleIds: readonly string[]): Promise<DigitalCardTargetOption[]> {
  const catalogueOn = enabledModuleIds.includes('catalogue')
  const rows = await client.fetch<TargetRows | null>(
    `{
      "pages": *[_type == "page" && projectSlug == $projectSlug && ${PUBLISHED}] | order(_createdAt asc)[0...300]{ _id, pageType, "title": coalesce(title[$defaultLocale], title.en, select(!defined(title._type) => title)), "slug": coalesce(slug[$defaultLocale].current, slug.current) },
      "catalogue": select($catalogue => *[_type in $catalogueTypes && ${PUBLISHED} && ${NAV_CATALOGUE_TARGET_FILTER} && (_type == "cataloguePage" || hasPage == true)] | order(_type asc, coalesce(name[$defaultLocale], name.en) asc)[0...300]{ _id, _type, "title": coalesce(heroTitle[$defaultLocale], name[$defaultLocale], heroTitle.en, name.en), "slug": slug[$defaultLocale].current }),
      "modules": *[_type == "project" && projectSlug == $projectSlug && ${PUBLISHED}][0].moduleInstallations[enabled != false]{ moduleId, "segment": config.publicSegment }
    }`,
    { projectSlug, defaultLocale, locale: defaultLocale, catalogue: catalogueOn, catalogueTypes: [...CATALOGUE_TARGET_TYPES] }
  )
  const m = getDigitalCardSiteMessages(defaultLocale)
  const segments = new Map<string, string>()
  for (const r of Array.isArray(rows?.modules) ? rows!.modules : []) {
    const seg = str(r?.segment).replace(/^\/+|\/+$/g, '')
    if (str(r?.moduleId) && seg && enabledModuleIds.includes(str(r?.moduleId))) segments.set(str(r?.moduleId), seg)
  }
  const out: DigitalCardTargetOption[] = []
  let hasHome = false
  for (const r of Array.isArray(rows?.pages) ? rows!.pages : []) {
    if (!DOC_ID.test(str(r._id))) continue
    const home = r.pageType === 'home'
    hasHome ||= home
    out.push({ id: str(r._id), title: (typeof r.title === 'string' && r.title.trim()) || str(r.slug) || str(r._id), group: 'pages', type: 'page', path: home ? '' : str(r.slug) })
  }
  const catalogueSegment = segments.get('catalogue') ?? ''
  let hasLanding = false
  if (catalogueOn && catalogueSegment) {
    const rowsCat = (Array.isArray(rows?.catalogue) ? rows!.catalogue : [])
      .filter((r) => DOC_ID.test(str(r._id)) && (CATALOGUE_TARGET_TYPES as readonly unknown[]).includes(r._type))
      .sort((a, b) => (CATALOGUE_TYPE_ORDER[str(a._type)] ?? 9) - (CATALOGUE_TYPE_ORDER[str(b._type)] ?? 9))
    for (const r of rowsCat) {
      const landing = r._type === 'cataloguePage'
      hasLanding ||= landing
      const title = (typeof r.title === 'string' && r.title.trim()) || (landing ? m.sectionCatalogue : str(r.slug) || str(r._id))
      out.push({ id: str(r._id), title, group: 'catalogue', type: str(r._type), path: landing ? catalogueSegment : str(r.slug) ? `${catalogueSegment}/${str(r.slug)}` : undefined })
    }
  }
  for (const section of DIGITAL_CARD_SECTIONS) {
    if (!cardSectionAvailable(section, enabledModuleIds) || (section === 'homepage' && hasHome)) continue
    out.push({ id: cardSectionTargetId(section), title: cardSectionLabel(section, m) ?? section, group: 'sections', type: 'section' })
  }
  for (const moduleId of DIGITAL_CARD_MODULE_TARGETS) {
    const seg = segments.get(moduleId)
    if (!seg || (moduleId === 'catalogue' && hasLanding)) continue
    out.push({ id: cardModuleTargetId(moduleId), title: cardModuleLabel(moduleId, m) ?? moduleId, group: moduleId === 'catalogue' ? 'catalogue' : 'sections', type: 'module', path: seg })
  }
  return out
}

async function readFiles(client: Client, projectSlug: string, ids: string[], languages: readonly string[]): Promise<DigitalCardSnapshot['files']> {
  if (!ids.length) return {}
  const rows = await client.fetch<Array<{ _id?: unknown; name?: unknown; title?: unknown; url?: unknown }> | null>(
    `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]{ _id, name, title, "url": coalesce(image.asset->url, animation.asset->url, videoUrl) }`,
    { projectSlug, ids }
  )
  const out: DigitalCardSnapshot['files'] = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = str(r._id)
    if (id) out[id] = { title: pickText(r.title, languages) || str(r.name) || id, url: typeof r.url === 'string' ? r.url : null }
  }
  return out
}

/** The card as the editor shows it: the draft when there is one, else the published version. */
export async function getDigitalCard(ctx: TenantAuthorizationContext, projectId: string, id: string, deps: DigitalCardDeps = {}): Promise<DigitalCardSnapshot> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isDigitalCardId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const kind = kindOf(doc)
  const facts = await readSiteFacts(client, grant.projectSlug)
  const reservations = grant.enabledModuleIds.includes('reservations')
  const personId = kind === 'person' ? refOf(doc.person) : null
  const links = linksOf(doc.links)
  const [people, background, inherited, pages, files] = await readsInOrder<[PersonRow[], DigitalCardImage | null, DigitalCardImage | null, DigitalCardTargetOption[], DigitalCardSnapshot['files']]>([
    personId ? readPeople(client, grant.projectSlug, [personId]) : Promise.resolve([]),
    readImage(client, refOf(doc.background), grant.projectSlug),
    kind === 'person'
      ? client
          .fetch<string | null>(`*[_type == "${DIGITAL_CARD_TYPE}" && projectSlug == $projectSlug && kind == "site" && ${PUBLISHED} && !defined(archivedAt)][0].background._ref`, { projectSlug: grant.projectSlug })
          .then((ref) => readImage(client, typeof ref === 'string' && DOC_ID.test(ref) ? ref : null, grant.projectSlug))
      : Promise.resolve(null),
    readLinkTargets(client, grant.projectSlug, facts.site.defaultLocale, grant.enabledModuleIds),
    readFiles(client, grant.projectSlug, [...new Set(links.flatMap((l) => [l.file, l.logo]).filter((f): f is string => Boolean(f)))], facts.site.languages),
  ])
  const person = people[0]
  const availability = kind === 'person' ? personAvailability(person, facts, reservations) : siteAvailability(facts, reservations)
  const state = stateOf(published, draft, (deps.now ?? (() => new Date()))())
  const urlName = kind === 'person' ? str(doc.urlName) : ''
  return {
    id,
    publicId: publicIdOf(doc),
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    isPublished: Boolean(published),
    archivedAt: archivedAtOf(published ?? draft),
    status: state.status,
    hasChanges: state.hasChanges,
    kind,
    person: personId
      ? {
          id: personId,
          name: personName(person),
          firstName: str(person?.firstName).trim() || personName(person).split(' ')[0] || '',
          photoUrl: str(person?.photoUrl) || null,
          live: listable(person),
        }
      : null,
    urlName,
    publishedUrlName: kind === 'person' && published && isValidUrlName(published.urlName) ? published.urlName : null,
    retiredUrlNames: strings(doc.retiredUrlNames),
    description: localized(doc.description),
    links,
    background,
    inheritedBackground: inherited,
    show: resolveShow(kind, doc.show, { socials: availability.socials.map((s) => s.key), locations: availability.locations.map((l) => l.key) }),
    availability,
    pages,
    files,
    site: facts.site,
    origin: facts.origin,
    path: cardPath(kind, isValidUrlName(urlName) ? urlName : null),
    live: published?._rev ? { rev: published._rev } : null,
  }
}

// ── Value cleaners ────────────────────────────────────────────────────────────

function cleanLine(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string') throw new DigitalCardError('invalid_value', `${what} must be text.`)
  const t = value.trim().replace(/\s+/g, ' ')
  if (t.length > max) throw new DigitalCardError('invalid_value', `${what} is too long.`)
  return t
}

function cleanBool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new DigitalCardError('invalid_value', `${what} must be yes or no.`)
  return value
}

function cleanUrl(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 2000) throw new DigitalCardError('invalid_value', 'The web address is too long or not text.')
  const v = value.trim()
  if (!v) return ''
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw new DigitalCardError('invalid_value', 'The web address must start with https://.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new DigitalCardError('invalid_value', 'The web address must start with https://.')
  return url.toString()
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9 ()./-]{6,}$/

/** A link target is complete (the publish check; drafts may hold incomplete links). */
function linkComplete(l: DigitalCardLinkValue): boolean {
  switch (DIGITAL_CARD_LINK_TARGET[l.kind]) {
    case 'url':
      return Boolean(l.url)
    case 'page':
      return Boolean(l.page || (l.kind === 'page' && (l.internalPage || l.moduleId)))
    case 'file':
      return Boolean(l.file)
    case 'value':
      return l.kind === 'email' ? EMAIL_RE.test(l.value.trim()) : PHONE_RE.test(l.value.trim())
  }
}

function cleanLabel(value: unknown, allowed: ReadonlySet<string>, max: number = DIGITAL_CARD_LIMITS.label, what = 'A label'): Record<string, string> {
  if (value === null || value === undefined) return {}
  const o = objectOf(value)
  if (!o) throw new DigitalCardError('invalid_value', `${what} must be one value per language.`)
  const out: Record<string, string> = {}
  for (const [loc, v] of Object.entries(o)) {
    if (!LOCALE_KEY.test(loc) || !allowed.has(loc)) throw new DigitalCardError('invalid_value', `Language "${loc}" is not on this site.`)
    const t = cleanLine(v ?? '', max, what)
    if (t) out[loc] = t
  }
  return out
}

/**
 * Validates the whole links array; returns the stored shape plus the referenced
 * ids to check: `pages` (form / booking — a `page`), `targets` (page links —
 * any type the page picker offers), files and logos. A page link's section or
 * module page must be on (Amendment B).
 */
function cleanLinks(value: unknown, allowed: ReadonlySet<string>, enabledModuleIds: readonly string[]) {
  const reservations = enabledModuleIds.includes('reservations')
  if (!Array.isArray(value)) throw new DigitalCardError('invalid_value', 'Links must be a list.')
  if (value.length > DIGITAL_CARD_LIMITS.links) throw new DigitalCardError('too_large', `A card has up to ${DIGITAL_CARD_LIMITS.links} links.`)
  const keys = new Set<string>()
  const pages = new Set<string>()
  const targets = new Set<string>()
  const files = new Set<string>()
  const logos = new Set<string>()
  const stored: Array<Record<string, unknown>> = []
  const values: DigitalCardLinkValue[] = []
  for (const raw of value) {
    const l = objectOf(raw)
    if (!l) throw new DigitalCardError('invalid_value', 'Unknown link.')
    const key = str(l.key)
    if (!KEY_RE.test(key) || keys.has(key)) throw new DigitalCardError('invalid_value', 'Unknown link.')
    keys.add(key)
    if (!(DIGITAL_CARD_LINK_KINDS as readonly unknown[]).includes(l.kind)) throw new DigitalCardError('invalid_value', 'Unknown link type.')
    const kind = l.kind as DigitalCardLinkKind
    if (kind === 'booking' && !reservations) throw new DigitalCardError('invalid_value', 'Booking links need the Reservations module.')
    const label = cleanLabel(l.label, allowed)
    const description = cleanLabel(l.description, allowed, DIGITAL_CARD_LIMITS.linkDescription, 'A link description')
    const hidden = l.hidden === undefined ? false : cleanBool(l.hidden, 'Hidden')
    const primary = l.primary === undefined ? false : cleanBool(l.primary, 'Primary Action')
    const target = DIGITAL_CARD_LINK_TARGET[kind]
    const v: DigitalCardLinkValue = { key, kind, label, description, url: '', page: null, file: null, logo: null, value: '', hidden, primary }
    if (target === 'url') v.url = cleanUrl(l.url)
    const given = (x: unknown) => x !== null && x !== undefined && x !== ''
    if (target === 'page' && given(l.page)) {
      if (typeof l.page !== 'string' || !DOC_ID.test(l.page) || l.page.startsWith('drafts.')) throw new DigitalCardError('invalid_value', 'Unknown page.')
      v.page = l.page
      ;(kind === 'page' ? targets : pages).add(l.page)
    }
    if (given(l.internalPage) || given(l.moduleId)) {
      // Amendment B — a page link may point at a built-in section or a module page instead (one target only).
      if (kind !== 'page' || v.page || (given(l.internalPage) && given(l.moduleId))) throw new DigitalCardError('invalid_value', 'Choose one page.')
      if (given(l.internalPage)) {
        if (typeof l.internalPage !== 'string' || !(DIGITAL_CARD_SECTIONS as readonly string[]).includes(l.internalPage)) throw new DigitalCardError('invalid_value', 'Unknown page.')
        if (!cardSectionAvailable(l.internalPage, enabledModuleIds)) throw new DigitalCardError('invalid_value', 'That section is not on this website.')
        v.internalPage = l.internalPage
      } else {
        if (typeof l.moduleId !== 'string' || !(DIGITAL_CARD_MODULE_TARGETS as readonly string[]).includes(l.moduleId)) throw new DigitalCardError('invalid_value', 'Unknown page.')
        if (!enabledModuleIds.includes(l.moduleId)) throw new DigitalCardError('invalid_value', 'That section is not on this website.')
        v.moduleId = l.moduleId
      }
    }
    if (target === 'file' && l.file !== null && l.file !== undefined && l.file !== '') {
      if (typeof l.file !== 'string' || !DOC_ID.test(l.file) || l.file.startsWith('drafts.')) throw new DigitalCardError('invalid_value', 'Unknown file.')
      v.file = l.file
      files.add(l.file)
    }
    if (l.logo !== null && l.logo !== undefined && l.logo !== '') {
      if (typeof l.logo !== 'string' || !DOC_ID.test(l.logo) || l.logo.startsWith('drafts.')) throw new DigitalCardError('invalid_value', 'Unknown logo.')
      v.logo = l.logo
      logos.add(l.logo)
    }
    if (target === 'value') {
      const t = cleanLine(l.value ?? '', DIGITAL_CARD_LIMITS.value, 'The number or address')
      if (t && kind === 'email' && !EMAIL_RE.test(t)) throw new DigitalCardError('invalid_value', 'This is not an e-mail address.')
      if (t && kind !== 'email' && !PHONE_RE.test(t)) throw new DigitalCardError('invalid_value', 'Enter the number in international format, e.g. +39 335 1234567.')
      v.value = t
    }
    values.push(v)
    stored.push({
      _key: key,
      _type: DIGITAL_CARD_LINK_TYPE,
      kind,
      ...(Object.keys(label).length && { label: { _type: 'localizedString', ...label } }),
      ...(Object.keys(description).length && { description: { _type: 'localizedString', ...description } }),
      ...(v.url && { url: v.url }),
      ...(v.page && { page: { _type: 'reference', _ref: v.page, _weak: true } }),
      ...(v.internalPage && { internalPage: v.internalPage }),
      ...(v.moduleId && { moduleId: v.moduleId }),
      ...(v.file && { file: { _type: 'reference', _ref: v.file } }),
      ...(v.logo && { logo: { _type: 'reference', _ref: v.logo } }),
      ...(v.value && { value: v.value }),
      hidden,
      primary,
    })
  }
  if (primaryLinkCount(values) > 1) throw new DigitalCardError('invalid_value', 'Only one shown link can be the Primary Action.', { field: 'links' })
  return { stored, pages: [...pages], targets: [...targets], files: [...files], logos: [...logos] }
}

/**
 * References must be this project's: form / booking → a page; page links → a
 * page, or (while the Catalogue is on) the catalogue landing page, a
 * collection or an item (Amendment B); files / logos → Media Library assets.
 */
async function assertTargetsExist(
  client: Client,
  projectSlug: string,
  refs: { pages: string[]; targets?: string[]; files: string[]; logos?: string[]; catalogue?: boolean },
) {
  const { pages, files } = refs
  const targets = refs.targets ?? []
  const logos = refs.logos ?? []
  if (pages.length) {
    const found = await client.fetch<string[] | null>(`*[_type == "page" && projectSlug == $projectSlug && _id in $ids]._id`, { projectSlug, ids: pages })
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!pages.every((p) => ok.has(p))) throw new DigitalCardError('invalid_value', 'That page is not on this website.')
  }
  if (targets.length) {
    const types = refs.catalogue ? [...DIGITAL_CARD_PAGE_REF_TYPES] : ['page']
    const found = await client.fetch<string[] | null>(`*[_type in $types && projectSlug == $projectSlug && _id in $ids]._id`, { projectSlug, ids: targets, types })
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!targets.every((p) => ok.has(p))) throw new DigitalCardError('invalid_value', 'That page is not on this website.')
  }
  if (files.length) {
    const found = await client.fetch<string[] | null>(`*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]._id`, { projectSlug, ids: files })
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!files.every((f) => ok.has(f))) throw new DigitalCardError('invalid_value', 'That file is not in this website’s Media Library.')
  }
  if (logos.length) {
    // A logo is an IMAGE of this project's Media Library (same check as the background).
    const found = await client.fetch<string[] | null>(`*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids && defined(image.asset)]._id`, { projectSlug, ids: logos })
    const ok = new Set(Array.isArray(found) ? found : [])
    if (!logos.every((f) => ok.has(f))) throw new DigitalCardError('invalid_value', 'That logo is not an image of this website’s Media Library.')
  }
}

const BOOLEAN_SWITCHES: Record<DigitalCardKind, readonly string[]> = {
  site: ['name', 'description', 'phone', 'email', 'whatsapp', 'saveContact', 'logo', 'businessName'],
  person: ['name', 'description', 'phone', 'email', 'whatsapp', 'saveContact', 'photo', 'role', 'businessName', 'profileLink'],
}
/** Lists: `hiddenSocials` (the profiles turned off — Amendment A; on by default) and the shown `locations`. */
const LIST_SWITCHES: Record<DigitalCardKind, readonly string[]> = { site: ['hiddenSocials', 'locations'], person: ['hiddenSocials'] }

function cleanSwitch(kind: DigitalCardKind, key: string, value: unknown): unknown {
  if (BOOLEAN_SWITCHES[kind].includes(key)) return cleanBool(value, 'A switch')
  if (LIST_SWITCHES[kind].includes(key)) {
    if (!Array.isArray(value) || value.length > 50) throw new DigitalCardError('invalid_value', 'Unknown list.')
    const out: string[] = []
    for (const v of value) {
      if (typeof v !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(v)) throw new DigitalCardError('invalid_value', 'Unknown item.')
      if (!out.includes(v)) out.push(v)
    }
    return out
  }
  if (kind === 'person' && key === 'nameMode') {
    if (!(DIGITAL_CARD_NAME_MODES as readonly unknown[]).includes(value)) throw new DigitalCardError('invalid_value', 'Unknown name mode.')
    return value
  }
  throw new DigitalCardError('invalid_field', `Switch "${key}" cannot be changed here.`)
}

function cleanUrlNameValue(value: unknown): string {
  if (typeof value !== 'string') throw new DigitalCardError('invalid_value', 'The URL name must be text.', { field: 'urlName' })
  const v = value.trim()
  if (!isValidUrlName(v)) throw new DigitalCardError('invalid_value', 'Only lowercase letters, numbers and single hyphens (e.g. sofia-rossi).', { field: 'urlName' })
  return v
}

// ── Create / open ─────────────────────────────────────────────────────────────

async function assertRoomForOneMore(cards: CardRow[]) {
  if (groupCards(cards).size >= MAX_CARDS) throw new DigitalCardError('too_large', 'This site has too many cards. Delete some first.')
}

/** The site card (D2 — one per project, at /link). A new, unpublished draft; its switches start at the defaults. Write permission. */
export async function createSiteCard(ctx: TenantAuthorizationContext, projectId: string, deps: DigitalCardDeps = {}): Promise<{ id: string; publicId: string; rev: string }> {
  const newId = deps.uuid ?? randomUUID
  const id = newId()
  const publicId = newId()
  return audited({ ctx, projectId, contentType: DIGITAL_CARD_TYPE, contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    const cards = await readCards(client, grant.projectSlug)
    if (cards.some((c) => c.kind === 'site')) throw new DigitalCardError('site_exists', 'This website already has a site card.')
    await assertRoomForOneMore(cards)
    const doc = { _id: `drafts.${id}`, _type: DIGITAL_CARD_TYPE, projectSlug: grant.projectSlug, publicId, kind: 'site', links: [] }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, publicId, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

/**
 * A person card for a People person (published, not off, not anonymised, not
 * archived). Refused when the person already has a card. The URL name is
 * suggested from the People slug / full name (D5). Write permission.
 */
export async function createPersonCard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { personId: string },
  deps: DigitalCardDeps = {}
): Promise<{ id: string; publicId: string; rev: string; urlName: string }> {
  const newId = deps.uuid ?? randomUUID
  const id = newId()
  const publicId = newId()
  return audited({ ctx, projectId, contentType: DIGITAL_CARD_TYPE, contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
    const client = deps.client ?? sanityWriteClient
    const personId = input?.personId
    if (typeof personId !== 'string' || !DOC_ID.test(personId) || personId.startsWith('drafts.')) throw new DigitalCardError('person_not_found', 'Unknown person.')
    const [facts, cards, people] = await readsInOrder<[SiteFacts, CardRow[], PersonRow[]]>([
      readSiteFacts(client, grant.projectSlug),
      readCards(client, grant.projectSlug),
      readPeople(client, grant.projectSlug, [personId]),
    ])
    const person = people.find((p) => p._id === personId)
    if (!person || !listable(person) || !personName(person)) throw new DigitalCardError('person_not_found', 'Unknown person.')
    if (cards.some((c) => refOf(c.person) === personId)) throw new DigitalCardError('person_has_card', 'This person already has a card.')
    await assertRoomForOneMore(cards)
    const peopleSlug = str(objectOf(objectOf(person.slug)?.[facts.site.defaultLocale])?.current) || null
    const fullName = [str(person.firstName).trim(), str(person.lastName).trim()].filter(Boolean).join(' ') || personName(person)
    const urlName = suggestUrlName(fullName, peopleSlug, takenUrlNames(cards as Array<{ _id: string }>))
    const doc = {
      _id: `drafts.${id}`,
      _type: DIGITAL_CARD_TYPE,
      projectSlug: grant.projectSlug,
      publicId,
      kind: 'person',
      person: { _type: 'reference', _ref: personId, _weak: true },
      urlName,
      links: [],
    }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, publicId, rev: created?._rev ?? '', urlName }, action: 'created' as const, state: null }
  })
}

/** Makes sure `drafts.<id>` exists — an exact copy of the published card. A server action, never a GET. */
export async function openDigitalCardForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: DigitalCardDeps = {}
): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const id = input?.id
  if (!isDigitalCardId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  if (archivedAtOf(published)) throw new DigitalCardError('archived', 'Restore this card to edit it.')
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = DIGITAL_CARD_TYPE
  copy.projectSlug = grant.projectSlug
  await singleProjectGuard(client, grant.projectSlug)
  try {
    const created = (await client.create(copy as { _id: string; _type: string }, DRAFT_SAVE)) as { _rev?: string }
    return { id, rev: created?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      if (again && ours(again, grant.projectSlug)) return { id, rev: again._rev ?? '', created: false }
      throw new DigitalCardError('conflict', 'This card was changed elsewhere.')
    }
    throw new DigitalCardError('failed', 'Could not open the card.')
  }
}

// ── URL name check (live, D5) ─────────────────────────────────────────────────

/** Is this URL name well formed and free for this card? With a free suggestion. Write permission. */
export async function checkDigitalCardUrlName(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; urlName: string },
  deps: DigitalCardDeps = {}
): Promise<{ valid: boolean; available: boolean; suggestion: string }> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isDigitalCardId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  if (kindOf(draft ?? published) !== 'person') throw new DigitalCardError('invalid_value', 'Only person cards have a URL name.')
  const name = typeof input.urlName === 'string' ? input.urlName.trim() : ''
  const valid = isValidUrlName(name)
  const taken = takenUrlNames((await readCards(client, grant.projectSlug)) as Array<{ _id: string }>, input.id)
  return { valid, available: valid && !taken.has(name), suggestion: suggestUrlName(name || 'card', null, taken) }
}

// ── Save (autosave) ───────────────────────────────────────────────────────────

/**
 * Validates and applies one autosave patch to `drafts.<id>`. Paths:
 *   description.<locale>  short line ('' clears)
 *   links                 the whole list (validated and rebuilt)
 *   background            Media Library asset id, or null (person: inherit)
 *   show.<switch>         one switch (D7)
 *   urlName               person cards; unique across current AND retired names
 * Returns the new revision.
 */
export async function saveDigitalCardDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: DigitalCardDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isDigitalCardId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new DigitalCardError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) throw new DigitalCardError('invalid_value', 'Nothing to save.')
  if (JSON.stringify(input.set).length > PATCH_BYTES) throw new DigitalCardError('too_large', 'Too much at once.')
  // Field allow-list before any read.
  for (const path of Object.keys(input.set)) {
    const [field, sub, ...rest] = path.split('.')
    const plain = (path === 'links' || path === 'background' || path === 'urlName') && sub === undefined
    const nested = (field === 'description' || field === 'show') && !!sub && rest.length === 0
    if (!plain && !nested) throw new DigitalCardError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const draftId = `drafts.${input.id}`
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ published, draft }, facts, cards] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, SiteFacts, CardRow[], void]>([
    readPair(client, input.id, grant.projectSlug),
    readSiteFacts(client, grant.projectSlug),
    readCards(client, grant.projectSlug),
    guard,
  ])
  if (!draft) notFound()
  if (archivedAtOf(published ?? draft)) throw new DigitalCardError('archived', 'Restore this card to edit it.')
  const kind = kindOf(draft)
  const allowedLocales = new Set(facts.site.languages)
  for (const k of Object.keys(localized(draft.description))) if (LOCALE_KEY.test(k)) allowedLocales.add(k)

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  let targets: { pages: string[]; targets: string[]; files: string[]; logos: string[] } = { pages: [], targets: [], files: [], logos: [] }
  let backgroundId: string | null = null

  for (const [path, value] of Object.entries(input.set)) {
    const [field, sub] = path.split('.')
    if (field === 'description') {
      if (!LOCALE_KEY.test(sub) || !allowedLocales.has(sub)) throw new DigitalCardError('invalid_field', `Language "${sub}" is not on this site.`)
      if (typeof value !== 'string' && value !== null) throw new DigitalCardError('invalid_value', 'The description must be text.')
      const t = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''
      if (cardTextLength(t) > DIGITAL_CARD_LIMITS.description) throw new DigitalCardError('invalid_value', 'The description is too long.', { field: 'description' })
      ensure.description = { _type: 'localizedText' }
      if (t) set[path] = t
      else unset.push(path)
      continue
    }
    if (field === 'show') {
      set[path] = cleanSwitch(kind, sub, value)
      ensure.show = {}
      continue
    }
    if (path === 'links') {
      const r = cleanLinks(value, allowedLocales, grant.enabledModuleIds)
      set.links = r.stored
      targets = { pages: r.pages, targets: r.targets, files: r.files, logos: r.logos }
      continue
    }
    if (path === 'background') {
      if (value === null || value === '') {
        unset.push('background')
        continue
      }
      if (typeof value !== 'string' || !DOC_ID.test(value) || value.startsWith('drafts.')) throw new DigitalCardError('invalid_value', 'Unknown image.')
      backgroundId = value
      set.background = { _type: 'reference', _ref: value }
      continue
    }
    // urlName
    if (kind !== 'person') throw new DigitalCardError('invalid_field', 'Only person cards have a URL name.')
    const name = cleanUrlNameValue(value)
    if (takenUrlNames(cards as Array<{ _id: string }>, input.id).has(name)) throw new DigitalCardError('url_name_taken', 'Another card of this website uses (or used) this URL name.', { field: 'urlName' })
    set.urlName = name
  }

  // The revision guard. A stale revision is a conflict — unless the draft already
  // holds exactly what this request asks for: then the request is a repeat of a
  // save whose answer never reached the browser (a reload or a lost response
  // while it was in flight). Nothing is written and nobody's change is
  // overwritten, so answering with the current revision is safe.
  if (draft._rev !== input.rev) {
    if (holdsAlready(draft, set, unset)) return { rev: draft._rev ?? '' }
    throw new DigitalCardError('conflict', 'This card was edited elsewhere.')
  }

  await assertTargetsExist(client, grant.projectSlug, { ...targets, catalogue: grant.enabledModuleIds.includes('catalogue') })
  if (backgroundId) {
    const ok = await client.fetch<string | null>(`*[_id == $id && _type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset)][0]._id`, { id: backgroundId, projectSlug: grant.projectSlug })
    if (ok !== backgroundId) throw new DigitalCardError('invalid_value', 'That image is not in this website’s Media Library.')
  }

  const result = (await commit(
    client,
    grant.projectSlug,
    () => {
      let p = client.patch(draftId).ifRevisionId(input.rev)
      if (Object.keys(ensure).length) p = p.setIfMissing(ensure)
      if (Object.keys(set).length) p = p.set(set)
      if (unset.length) p = p.unset(unset)
      return p.commit(DRAFT_SAVE)
    },
    guard
  )) as { _rev?: string } | undefined
  return { rev: result?._rev ?? '' }
}

/** Key-order-independent JSON, for comparing stored values. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

const valueAt = (doc: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), doc)

/** Does the draft already hold every value of this save (set paths equal, unset paths absent)? */
function holdsAlready(draft: Record<string, unknown>, set: Record<string, unknown>, unset: string[]): boolean {
  for (const [path, v] of Object.entries(set)) if (stable(valueAt(draft, path)) !== stable(v)) return false
  for (const path of unset) {
    const cur = valueAt(draft, path)
    if (cur !== undefined && cur !== null && cur !== '') return false
  }
  return true
}

// ── Publish / discard ─────────────────────────────────────────────────────────

/** What still blocks a publish (empty = ready). Pure; the editor shows the same list. */
export function publishBlockers(doc: Record<string, unknown>, personLive: boolean): DigitalCardMissing[] {
  const missing: DigitalCardMissing[] = []
  const links = linksOf(doc.links)
  if (doc.kind === 'person') {
    if (!refOf(doc.person) || !personLive) missing.push('person')
    if (!isValidUrlName(doc.urlName)) missing.push('urlName')
  }
  if (primaryLinkCount(links) > 1) missing.push('primary')
  if (links.some((l) => !l.hidden && !linkComplete(l))) missing.push('links')
  return missing
}

/**
 * Publishes `drafts.<id>` in one revision-guarded transaction. Refused with
 * `publish_blocked` (detail.missing) while a person card has no live person or
 * no valid URL name, or the shown links are incomplete / have two Primary
 * Actions. A renamed person card retires its previous live name (D5).
 */
export async function publishDigitalCardDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: DigitalCardDeps = {}
): Promise<{ rev: string }> {
  return audited(
    { ctx, projectId, contentType: DIGITAL_CARD_TYPE, contentId: isDigitalCardId(input?.id) ? input.id : null, intended: 'published', writer: deps.audit },
    async (transactionId) => {
      const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
      const client = deps.client ?? sanityWriteClient
      if (!isDigitalCardId(input?.id)) notFound()
      if (typeof input.rev !== 'string' || !input.rev) throw new DigitalCardError('conflict', 'Missing revision.')
      const { published, draft } = await readPair(client, input.id, grant.projectSlug)
      if (!draft) notFound()
      if (draft._rev !== input.rev) throw new DigitalCardError('conflict', 'This card was edited elsewhere.')
      if (archivedAtOf(published ?? draft)) throw new DigitalCardError('archived', 'Restore this card before publishing.')
      const kind = kindOf(draft)
      const cards = await readCards(client, grant.projectSlug)
      if (kind === 'site' && cards.some((c) => c.kind === 'site' && baseId(c._id!) !== input.id)) throw new DigitalCardError('site_exists', 'This website already has a site card.')
      let personLive = true
      if (kind === 'person') {
        const personId = refOf(draft.person)
        personLive = personId ? listable((await readPeople(client, grant.projectSlug, [personId]))[0]) : false
      }
      const missing = publishBlockers(draft, personLive)
      if (missing.length) throw new DigitalCardError('publish_blocked', 'This card is not ready to publish.', { missing })
      const urlName = kind === 'person' ? str(draft.urlName) : ''
      if (kind === 'person' && takenUrlNames(cards as Array<{ _id: string }>, input.id).has(urlName)) {
        throw new DigitalCardError('url_name_taken', 'Another card of this website uses (or used) this URL name.', { field: 'urlName' })
      }
      const links = linksOf(draft.links)
      const pages = [...new Set(links.filter((l) => !l.hidden && l.page && l.kind !== 'page').map((l) => l.page!))]
      const targets = [...new Set(links.filter((l) => !l.hidden && l.page && l.kind === 'page').map((l) => l.page!))]
      const files = [...new Set(links.filter((l) => !l.hidden && l.file).map((l) => l.file!))]
      await assertTargetsExist(client, grant.projectSlug, { pages, targets, files, catalogue: grant.enabledModuleIds.includes('catalogue') })

      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !WINDOW_FIELDS.has(k)) doc[k] = v
      doc._id = input.id
      doc._type = DIGITAL_CARD_TYPE
      doc.projectSlug = grant.projectSlug
      if (!publicIdOf(draft)) doc.publicId = (deps.uuid ?? randomUUID)()
      if (kind === 'person') {
        // D5 — the name that was live keeps working: it redirects to the new one, and is never given away.
        const retired = new Set([...strings(published?.retiredUrlNames), ...strings(draft.retiredUrlNames)])
        const wasLive = published && isValidUrlName(published.urlName) ? published.urlName : null
        if (wasLive && wasLive !== urlName) retired.add(wasLive)
        retired.delete(urlName)
        const list = [...retired].slice(-DIGITAL_CARD_LIMITS.retiredUrlNames)
        if (list.length) doc.retiredUrlNames = list
        else delete doc.retiredUrlNames
      }
      await commit(client, grant.projectSlug, () => {
        let tx = client.transaction().patch(`drafts.${input.id}`, { ifRevisionID: input.rev, unset: ['_publishGuard'] })
        if (published?._rev) {
          tx = tx.patch(input.id, { ifRevisionID: published._rev, unset: ['_publishGuard'] })
          tx = tx.createOrReplace(doc as { _id: string; _type: string })
        } else {
          tx = tx.create(doc as { _id: string; _type: string })
        }
        return tx.delete(`drafts.${input.id}`).commit({ transactionId })
      })
      const state = snapshotOf(doc)
      const now = (deps.now ?? (() => new Date()))()
      return { value: { rev: transactionId }, action: lifecycleAction(snapshotOf(published), state, 'optional', now), state }
    }
  )
}

/** Throws away unpublished changes of a published card. */
export async function discardDigitalCardDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: DigitalCardDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isDigitalCardId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (!published) throw new DigitalCardError('invalid_value', 'This card was never published.')
  if (draft._rev !== input.rev) throw new DigitalCardError('conflict', 'This card was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () => client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit())
}

// ── Unpublish / back online / archive / restore / delete ──────────────────────

export const DIGITAL_CARD_LIFECYCLE_OPS = ['unpublish', 'backOnline', 'archive', 'restore', 'deleteDraft', 'deletePermanently'] as const
export type DigitalCardLifecycleOp = (typeof DIGITAL_CARD_LIFECYCLE_OPS)[number]

/**
 * Unpublish / back online / archive / restore / delete through the lifecycle
 * service (ADR-032) with the card descriptor. Returns the DRAFT's new revision
 * (null when there is no draft) so an open editor can adopt it.
 *
 *   unpublish          takes it off the website now (the address redirects, D6)
 *   backOnline         puts it back
 *   archive / restore  archive implies unpublished; a restored card stays
 *                      OFFLINE until backOnline / publish
 *   deleteDraft        a never-published draft (digital-cards.write)
 *   deletePermanently  an ARCHIVED card (digital-cards.delete, owner)
 */
export async function runDigitalCardLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; op: DigitalCardLifecycleOp },
  deps: DigitalCardDeps = {}
): Promise<{ rev: string | null }> {
  if (!(DIGITAL_CARD_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new DigitalCardError('invalid_value', 'Unknown action.')
  // Gate before any read (the service re-checks the exact permission set).
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_WRITE_PERMISSION)
  if (input.op === 'deletePermanently') grantFor(ctx, projectId, DIGITAL_CARD_DELETE_PERMISSION)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  const d = DIGITAL_CARD_LIFECYCLE
  if (!isDigitalCardId(input.id)) notFound()
  const { published, draft } = await lifecycle.readPair(d, client, input.id, grant.projectSlug)
  // A document that exists nowhere answers like one of another project: ids cannot be probed.
  if (!published && !draft) notFound()
  const args = { id: input.id, rev: (input.op === 'deleteDraft' ? draft?._rev : published?._rev) ?? '' }
  switch (input.op) {
    case 'unpublish': {
      const r = await lifecycle.unpublishNow(d, ctx, projectId, args, sdeps)
      return { rev: r.draftRev }
    }
    case 'backOnline':
      await lifecycle.backOnline(d, ctx, projectId, args, sdeps)
      return { rev: null }
    case 'archive': {
      const r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
      return { rev: r.draftRev }
    }
    case 'restore': {
      const r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
      return { rev: r.draftRev }
    }
    case 'deleteDraft':
      await lifecycle.deleteDraft(d, ctx, projectId, args, sdeps)
      return { rev: null }
    case 'deletePermanently':
      await lifecycle.deletePermanently(d, ctx, projectId, args, sdeps)
      return { rev: null }
  }
}

const run = (op: DigitalCardLifecycleOp) => (ctx: TenantAuthorizationContext, projectId: string, input: { id: string }, deps?: DigitalCardDeps) =>
  runDigitalCardLifecycle(ctx, projectId, { id: input?.id, op }, deps)

export const unpublishDigitalCard = run('unpublish')
export const backOnlineDigitalCard = run('backOnline')
export const archiveDigitalCard = run('archive')
export const restoreDigitalCard = run('restore')
export const deleteDigitalCardDraft = run('deleteDraft')
/** Owner only (digital-cards.delete). Archived cards only. */
export const deleteDigitalCardPermanently = run('deletePermanently')

// ── Statistics (D11) ──────────────────────────────────────────────────────────

/**
 * Visits, clicks, per link, per source for one card over the last 7 / 30 / 90
 * / 365 days. Needs digital-cards.stats.read; the card must be this project's;
 * the project slug comes from the grant. `{ available: false }` while
 * migration 068 is not applied or the card has no statistics id yet.
 */
export async function getDigitalCardStats(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; days: number },
  deps: DigitalCardDeps = {}
): Promise<DigitalCardStatsRead> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_STATS_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!(DIGITAL_CARD_STATS_RANGES as readonly unknown[]).includes(input?.days)) throw new DigitalCardError('invalid_value', 'Unknown range.')
  if (!isDigitalCardId(input.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  const publicId = publicIdOf(published ?? draft)
  if (!publicId) return { available: false }
  const { from, to } = statsRange(input.days, (deps.now ?? (() => new Date()))())
  try {
    return await (deps.stats?.readStats ?? readStatsStore)({ projectSlug: grant.projectSlug, cardId: publicId, from, to })
  } catch {
    throw new DigitalCardError('failed', 'Could not read the statistics.')
  }
}

/** One card's numbers in the Analytics overview. */
export interface DigitalCardsOverviewCard {
  /** Sanity id: links to the card's Statistics tab. */
  id: string
  kind: DigitalCardKind
  /** The person's name; '' for the site card (shown as the site name). */
  name: string
  visits: number
  clicks: number
}

/** The Digital Cards block of the Analytics page: every card together. */
export type DigitalCardsOverview =
  | { available: false }
  | {
      available: true
      days: number
      siteName: string
      totals: { visits: number; clicks: number }
      /** Busiest first; cards that no longer exist are left out. */
      cards: DigitalCardsOverviewCard[]
      sources: Array<{ source: string; visits: number; clicks: number }>
    }

/**
 * Totals for ALL the project's cards (Analytics page, Amendment A): visits,
 * clicks, top cards, sources over the last `days` (7/30/90/365). Needs
 * digital-cards.stats.read; the project slug comes from the grant
 * (readStats with cardId null).
 */
export async function getDigitalCardsOverview(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { days: number },
  deps: DigitalCardDeps = {}
): Promise<DigitalCardsOverview> {
  const grant = grantFor(ctx, projectId, DIGITAL_CARD_STATS_PERMISSION)
  if (!(DIGITAL_CARD_STATS_RANGES as readonly unknown[]).includes(input?.days)) throw new DigitalCardError('invalid_value', 'Unknown range.')
  const client = deps.client ?? sanityWriteClient
  const { from, to } = statsRange(input.days, (deps.now ?? (() => new Date()))())
  let read: DigitalCardStatsRead
  try {
    read = await (deps.stats?.readStats ?? readStatsStore)({ projectSlug: grant.projectSlug, cardId: null, from, to })
  } catch {
    throw new DigitalCardError('failed', 'Could not read the statistics.')
  }
  if (!read.available) return { available: false }
  const [facts, rows, people] = await readsInOrder<[SiteFacts, CardRow[], PersonRow[]]>([
    readSiteFacts(client, grant.projectSlug),
    readCards(client, grant.projectSlug),
    readPeople(client, grant.projectSlug, null),
  ])
  const peopleById = new Map(people.map((p) => [p._id, p]))
  const byPublicId = new Map<string, { id: string; kind: DigitalCardKind; name: string }>()
  for (const [id, e] of groupCards(rows)) {
    const row = (e.published ?? e.draft)!
    const publicId = publicIdOf(row)
    if (!publicId) continue
    const kind = kindOf(row)
    const personId = kind === 'person' ? refOf(row.person) : null
    byPublicId.set(publicId, { id, kind, name: kind === 'person' ? personName(personId ? peopleById.get(personId) : null) : '' })
  }
  const cards: DigitalCardsOverviewCard[] = []
  for (const c of read.stats.cards) {
    const card = byPublicId.get(c.cardId)
    if (card) cards.push({ ...card, visits: c.visits, clicks: c.clicks })
  }
  return {
    available: true,
    days: input.days,
    siteName: facts.siteName,
    totals: { visits: read.stats.totals.visits, clicks: read.stats.totals.clicks },
    cards,
    sources: read.stats.sources.map((x) => ({ source: x.source, visits: x.visits, clicks: x.clicks })),
  }
}

/** Exposed for the tests: every language code the site may use. */
export const DIGITAL_CARD_KNOWN_LOCALES: readonly string[] = LOCALE_CODES
