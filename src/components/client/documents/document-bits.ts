'use client'

/**
 * Small pieces the Documents screens share (ADR-040 §15): the error sentence
 * for an action or upload code. All text comes from `clientDashboard.documents`.
 */
import type { useTranslations } from 'next-intl'

type T = ReturnType<typeof useTranslations>

const KNOWN = new Set([
  'unauthenticated', 'forbidden', 'support_mode', 'not_ready', 'not_found', 'limit_reached', 'groups_needed', 'file_too_large',
  'title_needed', 'title_too_long', 'note_too_long', 'locales_needed', 'last_language', 'file_type', 'page_does_not_fit',
  'page_without_section', 'groups_unavailable', 'invalid', 'wrong_type', 'empty', 'size_mismatch', 'hash_mismatch', 'too_large',
  'not_uploaded_yet', 'network', 'term_unknown', 'not_archived',
])

export function documentErrorText(t: T, code: string): string {
  return KNOWN.has(code) ? t(`errors.${code}` as 'errors.failed') : t('errors.failed')
}
