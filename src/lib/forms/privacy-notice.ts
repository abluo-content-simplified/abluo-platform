/**
 * Privacy notice line — a form that does not ask for a consent checkbox can
 * show one short line above the submit button instead ("By sending, you agree
 * to our privacy policy."). The editor marks the link text with {braces}; the
 * link goes to the form's chosen privacy page in the visitor's language.
 *
 * Pure (no React), so the split and the href are unit-tested without rendering.
 */
import { siteBasePath } from '@/lib/sanity/href'

export type NoticeParts = { before: string; link: string | null; after: string }

/** "By sending, you agree to our {privacy policy}." → before / link / after. Without braces: all text, no link. */
export function splitNoticeLink(text: string): NoticeParts {
  const m = text.match(/^([^{}]*)\{([^{}]+)\}([^{}]*)$/)
  if (!m) return { before: text.replace(/[{}]/g, ''), link: null, after: '' }
  return { before: m[1], link: m[2], after: m[3] }
}

/** Site-relative href of the privacy page, or null without a slug (the line then renders as plain text). */
export function privacyPageHref(slug: string | null | undefined, locale: string, urlSegment: string, hostScoped: boolean): string | null {
  const s = typeof slug === 'string' ? slug.trim().replace(/^\/+|\/+$/g, '') : ''
  if (!s || !urlSegment) return null
  return `${siteBasePath(locale, urlSegment, hostScoped)}/${s}`
}
