// ── Digital Cards module — shared constants and pure helpers (ADR-049) ────────
// Pure and browser-safe: imported by the schema (Studio bundle), the services
// (server), the website pages and the client components (contact decoding),
// and the dashboard. No server imports here.
//
// Build contract: docs/engineering/digital-cards/CONTRACTS.md — names below
// follow it exactly.

import { baseDocumentId } from '@/lib/sanity/fields/public-id'

export const DIGITAL_CARDS_MODULE_ID = 'digital-cards'

/** Sanity types owned by the module. */
export const DIGITAL_CARD_TYPE = 'digitalCard'
export const DIGITAL_CARD_LINK_TYPE = 'digitalCardLink'

/** Permissions (CONTRACTS.md). */
export const DIGITAL_CARD_PERMISSIONS = {
  read: 'digital-cards.read',
  write: 'digital-cards.write',
  delete: 'digital-cards.delete',
  statsRead: 'digital-cards.stats.read',
} as const

/** D2 — a site card (one per project, at /link) or a person card (/link/<urlName>). */
export const DIGITAL_CARD_KINDS = ['site', 'person'] as const
export type DigitalCardKind = (typeof DIGITAL_CARD_KINDS)[number]

/** D8 — link types. `form` and `booking` point at the PAGE that hosts the form / the booking (the `page` field). */
export const DIGITAL_CARD_LINK_KINDS = ['url', 'page', 'form', 'booking', 'whatsapp', 'phone', 'email', 'file'] as const
export type DigitalCardLinkKind = (typeof DIGITAL_CARD_LINK_KINDS)[number]
/** Which field of a link carries its target, per kind. */
export const DIGITAL_CARD_LINK_TARGET: Record<DigitalCardLinkKind, 'url' | 'page' | 'file' | 'value'> = {
  url: 'url',
  page: 'page',
  form: 'page',
  booking: 'page',
  whatsapp: 'value',
  phone: 'value',
  email: 'value',
  file: 'file',
}

/** People contact kinds a person card may show as socials (D7). */
export const DIGITAL_CARD_PERSON_SOCIAL_KINDS = ['instagram', 'linkedin', 'website', 'url'] as const

/** "Name as shown" on a person card. */
export const DIGITAL_CARD_NAME_MODES = ['full', 'first'] as const
export type DigitalCardNameMode = (typeof DIGITAL_CARD_NAME_MODES)[number]

/** D5 — the URL name of a person card. */
export const DIGITAL_CARD_URL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const DIGITAL_CARD_URL_NAME_MAX = 60

/** The website segment (reserved slug) and the dashboard segment. */
export const DIGITAL_CARD_SEGMENT = 'link'
export const DIGITAL_CARD_DASHBOARD_SEGMENT = 'cards'

/** D11 — statistics. */
export const DIGITAL_CARD_SOURCE_PATTERN = /^[a-z0-9-]{1,32}$/
export const DIGITAL_CARD_DIRECT_SOURCE = 'direct'
export const DIGITAL_CARD_QR_SOURCE = 'qr'
export const DIGITAL_CARD_RETENTION_MONTHS = 13
export const DIGITAL_CARD_HIT_KINDS = ['visit', 'click'] as const
export type DigitalCardHitKind = (typeof DIGITAL_CARD_HIT_KINDS)[number]
/** Dashboard statistics ranges, in days. */
export const DIGITAL_CARD_STATS_RANGES = [7, 30, 90, 365] as const

export const DIGITAL_CARD_LIMITS = {
  links: 30,
  label: 80,
  description: 300,
  value: 120,
  retiredUrlNames: 50,
} as const

// ── What's shown (D7) ─────────────────────────────────────────────────────────

/** Switches both kinds have. `socials` = site: socialLink.platform values; person: People contact _keys. */
export interface DigitalCardShowShared {
  name: boolean
  description: boolean
  phone: boolean
  email: boolean
  whatsapp: boolean
  saveContact: boolean
  socials: string[]
}

export interface SiteCardShow extends DigitalCardShowShared {
  logo: boolean
  businessName: boolean
  /** siteConfig.locations[]._key; the first one is the vCard address. */
  locations: string[]
}

export interface PersonCardShow extends DigitalCardShowShared {
  photo: boolean
  role: boolean
  nameMode: DigitalCardNameMode
  businessName: boolean
  profileLink: boolean
}

export type DigitalCardShow = SiteCardShow | PersonCardShow

/** What exists, so "all socials / all locations" can be filled in. */
export interface DigitalCardAvailable {
  socials?: readonly string[]
  locations?: readonly string[]
}

/**
 * The defaults of a new card (D7). Site: everything that exists on (pass the
 * available socials and locations). Person: photo, name, role, business name,
 * profile link on; phone, email, WhatsApp, Save contact OFF; no socials.
 */
export function defaultShow(kind: 'site', available?: DigitalCardAvailable): SiteCardShow
export function defaultShow(kind: 'person', available?: DigitalCardAvailable): PersonCardShow
export function defaultShow(kind: DigitalCardKind, available?: DigitalCardAvailable): DigitalCardShow
export function defaultShow(kind: DigitalCardKind, available: DigitalCardAvailable = {}): DigitalCardShow {
  if (kind === 'site') {
    return {
      name: true,
      description: true,
      phone: true,
      email: true,
      whatsapp: true,
      saveContact: true,
      socials: [...(available.socials ?? [])],
      logo: true,
      businessName: true,
      locations: [...(available.locations ?? [])],
    }
  }
  return {
    name: true,
    description: true,
    phone: false,
    email: false,
    whatsapp: false,
    saveContact: false,
    socials: [],
    photo: true,
    role: true,
    nameMode: 'full',
    businessName: true,
    profileLink: true,
  }
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : null)

/**
 * The stored switches over the defaults: a switch never stored keeps its
 * default, so a card created in Studio (no `show` yet) renders like a new one.
 */
export function resolveShow(kind: 'site', stored: unknown, available?: DigitalCardAvailable): SiteCardShow
export function resolveShow(kind: 'person', stored: unknown, available?: DigitalCardAvailable): PersonCardShow
export function resolveShow(kind: DigitalCardKind, stored: unknown, available?: DigitalCardAvailable): DigitalCardShow
export function resolveShow(kind: DigitalCardKind, stored: unknown, available: DigitalCardAvailable = {}): DigitalCardShow {
  const base = defaultShow(kind, available) as unknown as Record<string, unknown>
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const out: Record<string, unknown> = { ...base }
  for (const [key, def] of Object.entries(base)) {
    const v = s[key]
    if (typeof def === 'boolean' && typeof v === 'boolean') out[key] = v
    else if (Array.isArray(def)) {
      const list = strings(v)
      if (list) out[key] = list
    } else if (key === 'nameMode' && (DIGITAL_CARD_NAME_MODES as readonly unknown[]).includes(v)) out[key] = v
  }
  return out as unknown as DigitalCardShow
}

// ── URL names (D5) ────────────────────────────────────────────────────────────

const SPECIAL: Record<string, string> = { ß: 'ss', æ: 'ae', Æ: 'ae', ø: 'o', Ø: 'o', œ: 'oe', Œ: 'oe', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', þ: 'th', ð: 'd' }

function clip(slug: string, max: number): string {
  return slug.length <= max ? slug : slug.slice(0, max).replace(/-+$/, '')
}

/** "Sofía Rossi-Bianchi" → "sofia-rossi-bianchi". Empty string when nothing usable is left. */
export function slugifyUrlName(fullName: string): string {
  if (typeof fullName !== 'string') return ''
  const ascii = fullName
    .replace(/[ßæÆøØœŒłŁđĐþð]/g, (c) => SPECIAL[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clip(ascii, DIGITAL_CARD_URL_NAME_MAX)
}

/** A well-formed URL name (pattern + length). Uniqueness is checked separately. */
export function isValidUrlName(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= DIGITAL_CARD_URL_NAME_MAX && DIGITAL_CARD_URL_NAME_PATTERN.test(s)
}

/**
 * The URL name for a new person card (D5): the person's People slug when it is
 * free, else the full name slugified, else that with `-2`, `-3`… `taken` must
 * hold every current AND retired name of the project's other cards
 * (takenUrlNames).
 */
export function suggestUrlName(fullName: string, peopleSlug: string | null | undefined, taken: ReadonlySet<string>): string {
  if (isValidUrlName(peopleSlug) && !taken.has(peopleSlug)) return peopleSlug
  const base = slugifyUrlName(fullName) || (isValidUrlName(peopleSlug) ? peopleSlug : '') || 'card'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${clip(base, DIGITAL_CARD_URL_NAME_MAX - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Every name in use by the cards (current and retired), leaving out one document (and its draft). */
export function takenUrlNames(
  cards: ReadonlyArray<{ _id: string; urlName?: unknown; retiredUrlNames?: unknown }>,
  exceptId?: string | null,
): Set<string> {
  const except = exceptId ? baseDocumentId(exceptId) : null
  const out = new Set<string>()
  for (const c of cards) {
    if (except && baseDocumentId(c._id) === except) continue
    if (typeof c.urlName === 'string' && c.urlName) out.add(c.urlName)
    for (const r of strings(c.retiredUrlNames) ?? []) out.add(r)
  }
  return out
}

// ── Links (D8) ────────────────────────────────────────────────────────────────

/** At most one Primary Action among the shown links. */
export function primaryLinkCount(links: ReadonlyArray<{ primary?: unknown; hidden?: unknown }> | null | undefined): number {
  return (links ?? []).filter((l) => l && l.primary === true && l.hidden !== true).length
}

// ── Contacts in the HTML (D9) ─────────────────────────────────────────────────
//
// Reversible, never plain: UTF-8 bytes XOR a fixed key, reversed, then written
// with a LETTERS-ONLY nibble alphabet (a–p). The output therefore never holds
// an "@", a dot or a single digit, so neither an e-mail address nor any digit
// run of a phone number appears in the markup. Not security — spam friction.

const KEY = [0x5a, 0x13, 0x77, 0x2c, 0x41, 0x6e, 0x09, 0x38]
const NIBBLES = 'abcdefghijklmnop'

function utf8(s: string): number[] {
  return Array.from(new TextEncoder().encode(s))
}

export function encodeContact(value: string): string {
  const bytes = utf8(String(value ?? '')).map((b, i) => b ^ KEY[i % KEY.length]).reverse()
  return bytes.map((b) => NIBBLES[b >> 4] + NIBBLES[b & 15]).join('')
}

/** Inverse of encodeContact. Malformed input → ''. */
export function decodeContact(enc: string): string {
  if (typeof enc !== 'string' || enc.length % 2 !== 0 || /[^a-p]/.test(enc)) return ''
  const bytes: number[] = []
  for (let i = 0; i < enc.length; i += 2) bytes.push((NIBBLES.indexOf(enc[i]) << 4) | NIBBLES.indexOf(enc[i + 1]))
  const plain = bytes.reverse().map((b, i) => b ^ KEY[i % KEY.length])
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(plain))
  } catch {
    return ''
  }
}

// ── vCard 3.0 (D9) ────────────────────────────────────────────────────────────

export interface VCardAddress {
  street?: string | null
  postalCode?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
}

export interface VCardInput {
  /** Shown name. Falls back to first + last, then `org`. */
  fullName?: string | null
  firstName?: string | null
  lastName?: string | null
  org?: string | null
  title?: string | null
  phones?: ReadonlyArray<string | null | undefined>
  emails?: ReadonlyArray<string | null | undefined>
  address?: VCardAddress | null
  urls?: ReadonlyArray<string | null | undefined>
}

/** RFC 6350 §3.4 text escaping: backslash, comma, semicolon, newline. */
export function escapeVCardText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r\n|\r|\n/g, '\\n')
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const size = enc.encode(ch).length
    const limit = parts.length === 0 ? 75 : 74 // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += size
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const t = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '')

/** A vCard 3.0 (CRLF line ends, folded). Never contains a photo. */
export function buildVCard(input: VCardInput): string {
  const first = t(input.firstName)
  const last = t(input.lastName)
  const org = t(input.org)
  const fn = t(input.fullName) || [first, last].filter(Boolean).join(' ') || org || 'Contact'
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']
  lines.push(`FN:${escapeVCardText(fn)}`)
  if (first || last) lines.push(`N:${escapeVCardText(last)};${escapeVCardText(first)};;;`)
  else lines.push(`N:${org && fn === org ? '' : escapeVCardText(fn)};;;;`)
  if (org) lines.push(`ORG:${escapeVCardText(org)}`)
  if (t(input.title)) lines.push(`TITLE:${escapeVCardText(t(input.title))}`)
  for (const p of input.phones ?? []) if (t(p)) lines.push(`TEL;TYPE=VOICE:${escapeVCardText(t(p))}`)
  for (const e of input.emails ?? []) if (t(e)) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(t(e))}`)
  const a = input.address
  if (a && [a.street, a.postalCode, a.city, a.state, a.country].some((x) => t(x))) {
    lines.push(`ADR;TYPE=WORK:;;${[a.street, a.city, a.state, a.postalCode, a.country].map((x) => escapeVCardText(t(x))).join(';')}`)
  }
  for (const u of input.urls ?? []) if (t(u)) lines.push(`URL:${escapeVCardText(t(u))}`)
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ── Sources (D11) ─────────────────────────────────────────────────────────────

/** Referrer host (registrable part) → source. Matched on the host or any parent domain. */
export const DIGITAL_CARD_REFERRER_SOURCES: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, 'facebook'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'whatsapp'],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'x'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, 'telegram'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'pinterest'],
  [/(^|\.)threads\.net$/, 'threads'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
]

/**
 * The source of one visit: an allow-listed `?src=` tag first, else a known
 * referrer host, else `direct`. Never stores the referrer itself.
 */
export function normalizeSource(srcParam: string | null | undefined, referrerHost: string | null | undefined): string {
  const src = typeof srcParam === 'string' ? srcParam.trim().toLowerCase() : ''
  if (DIGITAL_CARD_SOURCE_PATTERN.test(src)) return src
  const host = typeof referrerHost === 'string' ? referrerHost.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') : ''
  if (host) for (const [re, source] of DIGITAL_CARD_REFERRER_SOURCES) if (re.test(host)) return source
  return DIGITAL_CARD_DIRECT_SOURCE
}

// ── Paths ─────────────────────────────────────────────────────────────────────

/** `/link` for the site card, `/link/<urlName>` for a person card (tenant-relative, no locale). */
export function cardPath(kind: DigitalCardKind, urlName?: string | null): string {
  if (kind === 'person' && isValidUrlName(urlName)) return `/${DIGITAL_CARD_SEGMENT}/${urlName}`
  return `/${DIGITAL_CARD_SEGMENT}`
}

/** D12 — what the QR code encodes: the canonical origin (ADR-034) + path + `?src=qr`. */
export function qrTarget(canonicalOrigin: string, path: string): string {
  const origin = String(canonicalOrigin ?? '').replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${origin}${p}?src=${DIGITAL_CARD_QR_SOURCE}`
}

/** A tagged share link (dashboard "Tagged links"): the card URL with `?src=<source>`. */
export function taggedLink(canonicalOrigin: string, path: string, source: string): string {
  const s = DIGITAL_CARD_SOURCE_PATTERN.test(source) ? source : DIGITAL_CARD_DIRECT_SOURCE
  return qrTarget(canonicalOrigin, path).replace(/\?src=qr$/, `?src=${s}`)
}
