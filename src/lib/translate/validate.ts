/**
 * Request validation for POST /api/translate (ADR-023 §6). Pure.
 */

import { LOCALE_CODES, type SupportedLocale } from '@/lib/i18n/locales'
import { TranslateError, type TranslateFormat, type TranslateRequestBody } from './types'
import { countCharacters } from './providers/types'

/** Upper bound per request — a runaway or abusive call cannot burn the account's credit. */
export const MAX_CHARS_PER_REQUEST = 20_000
export const MAX_TEXTS_PER_REQUEST = 50

export type ValidTranslateRequest = {
  projectSlug: string
  sourceLocale: SupportedLocale
  targetLocales: SupportedLocale[]
  texts: string[]
  format: TranslateFormat
  documentId: string | null
  /** Source characters × number of targets — what the quota check charges. */
  requestedCharacters: number
}

function isLocale(v: unknown): v is SupportedLocale {
  return typeof v === 'string' && (LOCALE_CODES as string[]).includes(v)
}

export function validateTranslateRequest(raw: unknown): ValidTranslateRequest {
  if (!raw || typeof raw !== 'object') throw new TranslateError('invalid_request', 'body is not an object')
  const b = raw as Partial<TranslateRequestBody>

  if (typeof b.projectSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(b.projectSlug)) {
    throw new TranslateError('invalid_request', 'projectSlug')
  }
  if (!isLocale(b.sourceLocale)) throw new TranslateError('invalid_request', 'sourceLocale')
  if (!Array.isArray(b.targetLocales) || b.targetLocales.length === 0 || !b.targetLocales.every(isLocale)) {
    throw new TranslateError('invalid_request', 'targetLocales')
  }
  const targets = Array.from(new Set(b.targetLocales)).filter((t) => t !== b.sourceLocale)
  if (targets.length === 0) throw new TranslateError('invalid_request', 'no target differs from source')

  if (!Array.isArray(b.texts) || b.texts.length === 0 || !b.texts.every((t) => typeof t === 'string')) {
    throw new TranslateError('invalid_request', 'texts')
  }
  if (b.texts.every((t) => t.trim() === '')) throw new TranslateError('invalid_request', 'texts are empty')
  if (b.texts.length > MAX_TEXTS_PER_REQUEST) throw new TranslateError('too_large', 'too many texts')

  const format: TranslateFormat = b.format === 'html' ? 'html' : 'text'
  if (b.format !== undefined && b.format !== 'text' && b.format !== 'html') {
    throw new TranslateError('invalid_request', 'format')
  }

  const perTarget = countCharacters(b.texts)
  if (perTarget > MAX_CHARS_PER_REQUEST) throw new TranslateError('too_large', `${perTarget} characters`)

  const documentId =
    typeof b.documentId === 'string' && b.documentId.length <= 200 ? b.documentId : null

  return {
    projectSlug: b.projectSlug,
    sourceLocale: b.sourceLocale,
    targetLocales: targets,
    texts: b.texts,
    format,
    documentId,
    requestedCharacters: perTarget * targets.length,
  }
}
