/**
 * Translation status model (ADR-023 §4). Client-safe and pure — used by the
 * Studio input to decide what a click may overwrite and when a machine value
 * has been hand-edited.
 *
 * Stored beside the value, in the hidden `translationStatus` field of every
 * localized type:
 *
 *   { en: '…', fr: '…', translationStatus: { fr: { status: 'machine', textHash, … } } }
 *
 * Absent = `original`. The module never writes `original` explicitly.
 */

import type { TranslationProviderId } from './types'

export type TranslationStatus = 'original' | 'machine' | 'reviewed'

export type TranslationMeta = {
  _type?: 'translationMeta'
  status: Exclude<TranslationStatus, 'original'>
  provider?: TranslationProviderId
  sourceLocale?: string
  translatedAt?: string
  /** Hash of the text exactly as the machine wrote it. */
  textHash?: string
  /** Hash of the source text that was translated. */
  sourceHash?: string
}

export type TranslationStatusMap = Partial<Record<string, TranslationMeta>>

/**
 * FNV-1a 32-bit over UTF-16 units, hex. Not cryptographic — it only has to
 * notice that an editor changed a value. Synchronous so it can run in render.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Stable text for hashing any stored value (string or Portable Text array). */
export function hashValue(value: unknown): string {
  return hashText(typeof value === 'string' ? value : JSON.stringify(value ?? ''))
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * The effective status of one locale's value.
 *
 * A `machine` value whose text no longer matches `textHash` has been edited by
 * hand → `reviewed` (ADR-023 decision 5), even before the input persists that.
 */
export function effectiveStatus(
  value: unknown,
  meta: TranslationMeta | undefined
): TranslationStatus {
  if (!meta) return 'original'
  if (meta.status === 'machine' && meta.textHash && !isEmpty(value) && hashValue(value) !== meta.textHash) {
    return 'reviewed'
  }
  return meta.status
}

/**
 * Whether the one-click action may write this target (ADR-023 §5): only when
 * it is empty, or still an untouched machine translation. `original` and
 * `reviewed` text is never overwritten by the one-click action.
 */
export function isWritableTarget(value: unknown, meta: TranslationMeta | undefined): boolean {
  if (isEmpty(value)) return true
  return effectiveStatus(value, meta) === 'machine'
}

/**
 * Locales whose persisted status says `machine` but whose text was edited —
 * the input writes `reviewed` for these.
 */
export function localesToMarkReviewed(
  value: Record<string, unknown> | undefined,
  statusMap: TranslationStatusMap | undefined
): string[] {
  if (!value || !statusMap) return []
  return Object.entries(statusMap)
    .filter(([code, meta]) => meta?.status === 'machine' && effectiveStatus(value[code], meta) === 'reviewed')
    .map(([code]) => code)
}

/** Build the meta written alongside a fresh machine translation. */
export function machineMeta(args: {
  text: unknown
  source: unknown
  sourceLocale: string
  provider: TranslationProviderId
  now?: Date
}): TranslationMeta {
  return {
    _type: 'translationMeta',
    status: 'machine',
    provider: args.provider,
    sourceLocale: args.sourceLocale,
    translatedAt: (args.now ?? new Date()).toISOString(),
    textHash: hashValue(args.text),
    sourceHash: hashValue(args.source),
  }
}
