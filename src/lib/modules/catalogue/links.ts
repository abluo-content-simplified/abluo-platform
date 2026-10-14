// ── Catalogue — item links (ADR-033 Amendment F-2) ────────────────────────────
//
// Pure, browser-safe. An item may carry an ordered list of external links
// (label per language + an http/https address). The address gate is the
// platform's own (`safeLinkHref` → `normalizeHref`) narrowed to http(s): no
// mailto:, tel:, site-relative or fragment links in V1. The new-tab rule is
// src/lib/links/link-target.ts — not restated here.

import { safeLinkHref } from '@/lib/links/safe-href'

export const CATALOGUE_LINK_LIMITS = { links: 12, label: 80 } as const

/** The address when it is a safe http(s) URL (trimmed), else null. javascript:, data:, mailto:, "/x", "#x" → null. */
export function catalogueLinkUrl(value: unknown): string | null {
  const href = safeLinkHref(value)
  return href && /^https?:\/\//i.test(href) ? href : null
}

/** Studio validation message, or true. Empty is the caller's concern (the field is required there). */
export function linkUrlIssue(value: unknown): true | string {
  if (value == null || value === '') return true
  return catalogueLinkUrl(value) ? true : 'Use a full web address starting with http:// or https://.'
}
