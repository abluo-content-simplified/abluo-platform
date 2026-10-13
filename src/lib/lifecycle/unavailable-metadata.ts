/**
 * ADR-032 D12 — metadata for a detail URL whose item is not public (scheduled,
 * unpublished, archived, deleted or never existed). Neutral and identical in
 * every case: the localised "page not available" title, no description, no
 * canonical or hreflang, noindex.
 */

import type { Metadata } from 'next'
import { getUnavailablePageMessages } from '@/lib/i18n/unavailable-page-messages'

export function unavailableMetadata(locale: string): Metadata {
  return {
    title: getUnavailablePageMessages(locale).heading,
    robots: { index: false, follow: false },
  }
}
