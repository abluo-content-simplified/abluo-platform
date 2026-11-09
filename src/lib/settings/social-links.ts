/**
 * The website's social profiles (`siteConfig.socialLinks`, type `socialLink`)
 * — shared by Website Settings (Studio), the client dashboard's
 * Settings → Social Profiles page, the website footer and Digital Cards.
 * Pure and browser-safe.
 *
 * SOCIAL_PLATFORMS must equal the `socialLink.platform` options list in
 * src/lib/sanity/schema.ts (a test reads both).
 */

export const SOCIAL_PLATFORMS = ['youtube', 'instagram', 'linkedin', 'facebook', 'x', 'tiktok', 'threads', 'pinterest'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/** Brand names, the same in every language. */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  x: 'X',
  tiktok: 'TikTok',
  threads: 'Threads',
  pinterest: 'Pinterest',
}

/** Loose per-platform host check (the profile must be ON that platform). */
const HOSTS: Record<SocialPlatform, RegExp> = {
  youtube: /(^|\.)(youtube\.com|youtu\.be)$/,
  instagram: /(^|\.)instagram\.com$/,
  linkedin: /(^|\.)linkedin\.com$/,
  facebook: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/,
  x: /(^|\.)(x\.com|twitter\.com)$/,
  tiktok: /(^|\.)tiktok\.com$/,
  threads: /(^|\.)threads\.(net|com)$/,
  pinterest: /(^|\.)pinterest\.[a-z.]+$/,
}

export const MAX_SOCIAL_LINKS = 20
export const MAX_SOCIAL_URL = 300

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return typeof v === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(v)
}

export function socialPlatformLabel(platform: string): string {
  return isSocialPlatform(platform) ? SOCIAL_PLATFORM_LABELS[platform] : platform
}

/** "https://www.linkedin.com/in/anna/" → "linkedin.com/in/anna" (for showing, never for linking). */
export function shortUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
}

export type SocialUrlProblem = 'empty' | 'not_https' | 'wrong_platform'

/**
 * The address as stored, or why not. https only (an address without a scheme
 * gets https:// added); the host must belong to the platform. Loose on
 * purpose: any path on the platform is accepted.
 */
export function cleanSocialUrl(platform: SocialPlatform, raw: unknown): { ok: true; url: string } | { ok: false; problem: SocialUrlProblem } {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return { ok: false, problem: 'empty' }
  if (v.length > MAX_SOCIAL_URL) return { ok: false, problem: 'not_https' }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return { ok: false, problem: 'not_https' }
  }
  if (u.protocol !== 'https:' || u.username || u.password) return { ok: false, problem: 'not_https' }
  if (!HOSTS[platform].test(u.hostname.toLowerCase())) return { ok: false, problem: 'wrong_platform' }
  return { ok: true, url: u.toString() }
}

export interface SocialLinkRow {
  _key: string
  platform: SocialPlatform
  url: string
}

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/

/** A whole list as the client sends it → the list to store, or the first problem. Keys are kept (Studio and the cards refer to rows by platform). */
export function toStoredSocialLinks(value: unknown):
  | { ok: true; value: Array<SocialLinkRow & { _type: 'socialLink' }> }
  | { ok: false; error: 'invalid_value' | 'too_many'; index?: number } {
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_value' }
  if (value.length > MAX_SOCIAL_LINKS) return { ok: false, error: 'too_many' }
  const out: Array<SocialLinkRow & { _type: 'socialLink' }> = []
  const keys = new Set<string>()
  for (const [index, row] of value.entries()) {
    const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
    if (!r || typeof r._key !== 'string' || !KEY_RE.test(r._key) || keys.has(r._key) || !isSocialPlatform(r.platform)) return { ok: false, error: 'invalid_value', index }
    const url = cleanSocialUrl(r.platform, r.url)
    if (!url.ok) return { ok: false, error: 'invalid_value', index }
    keys.add(r._key)
    out.push({ _type: 'socialLink', _key: r._key, platform: r.platform, url: url.url })
  }
  return { ok: true, value: out }
}

/** Stored rows → what the page edits (rows without a known platform are kept out of the editor — Studio still shows them). */
export function socialRowsFromStored(stored: unknown): SocialLinkRow[] {
  if (!Array.isArray(stored)) return []
  const out: SocialLinkRow[] = []
  for (const r of stored) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    if (typeof row._key === 'string' && KEY_RE.test(row._key) && isSocialPlatform(row.platform)) out.push({ _key: row._key, platform: row.platform, url: typeof row.url === 'string' ? row.url : '' })
  }
  return out
}
