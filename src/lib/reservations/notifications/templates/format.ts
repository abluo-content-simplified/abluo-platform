// ── Reservations emails — pure formatting helpers (ADR-044 D10, D16.13) ───────
import { DICTIONARIES, type EmailLocale } from './dictionaries'

export const DEFAULT_TIME_ZONE = 'Europe/Rome'

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** {name} placeholders; unknown ones stay visible (a typo must show in tests, not vanish). */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** One line, no control characters: safe for a Subject header. */
export const oneLine = (s: string, max = 200): string => s.replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, max)

const isEmailLocale = (v: unknown): v is EmailLocale => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DICTIONARIES, v)

/**
 * Language of one email (D16.13): the booking's own language, else the site's
 * default language, else English. Region tags ("pt-BR") fall back to the base.
 */
export function chooseEmailLocale(input: { bookingLocale?: unknown; siteDefaultLocale?: unknown }): EmailLocale {
  for (const v of [input.bookingLocale, input.siteDefaultLocale]) {
    if (typeof v !== 'string') continue
    const base = v.trim().toLowerCase().split(/[-_]/)[0]
    if (isEmailLocale(base)) return base
  }
  return 'en'
}

/** Intl needs a regional tag for European date order (plain "en" would be US). */
const INTL: Record<EmailLocale, string> = { en: 'en-GB', it: 'it-IT', de: 'de-DE', fr: 'fr-FR', nl: 'nl-NL', es: 'es-ES', pt: 'pt-PT' }
export const intlLocale = (l: EmailLocale): string => INTL[l]

function safeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz } catch { return DEFAULT_TIME_ZONE }
}

/** "Thu 12 November 2026" in the zone. */
export function formatDate(iso: string, locale: EmailLocale, timeZone?: string | null): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: safeZone(timeZone) }).format(d)
}

/** 24-hour "18:30" in the zone, whatever the language. */
export function formatTime(iso: string, locale: EmailLocale, timeZone?: string | null): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: safeZone(timeZone) }).format(d)
}

export const formatDateTime = (iso: string, locale: EmailLocale, tz?: string | null): string => {
  const date = formatDate(iso, locale, tz)
  const time = formatTime(iso, locale, tz)
  return date && time ? `${date}, ${time}` : date || time
}

/** EUR is the only currency of v1 (money.ts). */
export function formatAmount(cents: number, locale: EmailLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

/** A tenant-written localized text: the email language → site default → English → any. */
export function pickLocalized(value: unknown, locale: EmailLocale, siteDefault?: string | null): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const map = value as Record<string, unknown>
  const take = (k?: string | null) => (k && typeof map[k] === 'string' && (map[k] as string).trim() ? (map[k] as string).trim() : null)
  return take(locale) ?? take(siteDefault?.split(/[-_]/)[0]) ?? take('en') ?? Object.values(map).find((v): v is string => typeof v === 'string' && !!v.trim())?.trim() ?? null
}

/** Plain text → HTML paragraphs (blank line = paragraph, newline = <br>). Escapes everything. */
export function paragraphsHtml(text: string): string {
  return text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${esc(p).replace(/\r?\n/g, '<br>')}</p>`).join('\n')
}
