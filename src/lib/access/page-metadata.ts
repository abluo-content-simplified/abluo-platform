/**
 * Site Access — metadata for restricted pages (ADR-040 §9). Pure.
 *
 * Denied: nothing about the page — no title, description, Open Graph text or
 * image of its own, no canonical or hreflang (they would name its slugs in
 * other languages), and robots noindex/nofollow/noarchive. Only the site name
 * and the generic localized "Members only".
 *
 * Granted: the page's normal metadata, but never indexable — a restricted page
 * stays out of search engines even when a member's browser is the one asking.
 */
import type { Metadata } from 'next'
import { getAccessMessages } from '@/lib/i18n/access-messages'

export const RESTRICTED_ROBOTS: NonNullable<Metadata['robots']> = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false, noimageindex: true },
}

export function deniedPageMetadata(input: { locale: string; siteName: string }): Metadata {
  const m = getAccessMessages(input.locale)
  const title = `${m.restrictedTitle} — ${input.siteName}`
  return {
    title,
    description: null,
    robots: RESTRICTED_ROBOTS,
    alternates: null,
    // `openGraph` without an `images` key keeps the site-wide card (never a
    // page image); the title is the generic one.
    openGraph: { title, siteName: input.siteName, type: 'website' },
    twitter: { title, description: undefined },
  }
}

export function grantedPageMetadata(meta: Metadata): Metadata {
  return { ...meta, robots: RESTRICTED_ROBOTS }
}
