'use client'

/**
 * One short privacy line above a form's submit button (see
 * src/lib/forms/privacy-notice.ts). Website Design System tokens only, so it
 * follows the light and dark theme. Renders nothing without text.
 */
import { useHostScoped } from '@/components/SiteLinkScope'
import { privacyPageHref, splitNoticeLink } from '@/lib/forms/privacy-notice'

export function FormPrivacyNotice({ text, pageSlug, locale, urlSegment }: { text?: string | null; pageSlug?: string | null; locale: string; urlSegment: string }) {
  const hostScoped = useHostScoped()
  const value = text?.trim()
  if (!value) return null
  const { before, link, after } = splitNoticeLink(value)
  const href = link ? privacyPageHref(pageSlug, locale, urlSegment, hostScoped) : null
  return (
    <p className="mt-5 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }} data-form-privacy-notice="">
      {before}
      {link && (href ? (
        <a href={href} target="_blank" rel="noopener" className="underline underline-offset-2 hover:opacity-80" style={{ color: 'var(--color-text-primary)' }}>
          {link}
        </a>
      ) : link)}
      {after}
    </p>
  )
}
