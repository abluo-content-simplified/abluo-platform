/**
 * Settings: the ONLY paths the dashboard may write, and how each value is
 * cleaned. The client sends `{ path: value }` pairs, never a document or a
 * free-form path; anything not matched here is refused as `invalid_field`.
 * Pure and browser-safe. This allow-list is the real boundary of the page
 * (the permission is coarse): technical configuration is simply not listed.
 */
import { toStored, type AmazonRowsError } from './amazon-rows'

/** siteConfig.amazonTrackingIds (whole list; rows are small and keyed by marketplace). */
export const AMAZON_PATH = 'amazonTrackingIds'
/** Catalogue module config, one language: `affiliateDisclosure.<locale>`. */
export const DISCLOSURE_PREFIX = 'affiliateDisclosure.'
export const MAX_DISCLOSURE_LENGTH = 600

const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/

type StoredRows = NonNullable<ReturnType<typeof okStored>>
function okStored(rows: unknown) {
  const r = toStored(rows as never)
  return r.ok ? r.value : null
}

export type ParsedSet =
  | { ok: true; amazon?: StoredRows; disclosure: Record<string, string> }
  | { ok: false; error: 'invalid_field' | 'invalid_value' | AmazonRowsError; path?: string }

/** Control characters out, line breaks kept as spaces, trimmed. */
export function cleanDisclosure(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

/** Validates a whole batch. Nothing is partially accepted: one bad path refuses the batch (the autosave engine then isolates it). */
export function parseSettingsSet(set: unknown): ParsedSet {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return { ok: false, error: 'invalid_value' }
  let amazon: StoredRows | undefined
  const disclosure: Record<string, string> = {}
  for (const [path, value] of Object.entries(set as Record<string, unknown>)) {
    if (path === AMAZON_PATH) {
      const r = toStored(value as never)
      if (!r.ok) return { ok: false, error: r.error, path }
      amazon = r.value
    } else if (path.startsWith(DISCLOSURE_PREFIX)) {
      const locale = path.slice(DISCLOSURE_PREFIX.length)
      if (!LOCALE.test(locale)) return { ok: false, error: 'invalid_field', path }
      const text = cleanDisclosure(value)
      if (text === null || text.length > MAX_DISCLOSURE_LENGTH) return { ok: false, error: 'invalid_value', path }
      disclosure[locale] = text
    } else {
      return { ok: false, error: 'invalid_field', path }
    }
  }
  if (amazon === undefined && Object.keys(disclosure).length === 0) return { ok: false, error: 'invalid_value' }
  return { ok: true, ...(amazon !== undefined ? { amazon } : {}), disclosure }
}

/** The combined revision the page holds: siteConfig (published) and project document, joined. */
export const encodeRev = (siteRev: string, projectRev: string): string => `${siteRev}|${projectRev}`
export function decodeRev(rev: unknown): { siteRev: string; projectRev: string } {
  const [siteRev = '', projectRev = ''] = typeof rev === 'string' ? rev.split('|') : []
  return { siteRev, projectRev }
}
