'use client'

/**
 * CtaButton — presentation-agnostic CTA renderer.
 *
 * Renders the correct HTML element based on the resolved CTA action type:
 *   link      → <Link> (internal) or <a target="_blank"> (external)
 *   download  → <a download> (triggers browser file download)
 *   form      → <button> with data-form-id (modal trigger wired in a future session)
 *   none      → null (renders nothing — CTA is incomplete in Studio)
 *
 * Styling is entirely the consuming component's responsibility.
 * Pass className and/or style to control appearance.
 * CtaButton never adds visual defaults — no colours, no padding, no font.
 *
 * Analytics: fires a console.info on every click (can be replaced with your
 * analytics provider). The data-analytics-name attribute is always present
 * for third-party tag managers.
 *
 * Usage:
 *   const resolved = resolveCta(section.primaryCta)
 *   <CtaButton cta={resolved} className="rounded-xl bg-primary px-6 py-3 text-white">
 *     {resolved.label}
 *   </CtaButton>
 *
 *   // Or use the default label rendering:
 *   <CtaButton cta={resolved} className="..." />
 */

import Link from 'next/link'
import type { ResolvedCta } from '@/lib/sanity/types'

interface CtaButtonProps {
  cta: ResolvedCta
  /** Extra CSS classes — controls all visual styling. */
  className?: string
  style?: React.CSSProperties
  /** Override label. If omitted, renders cta.label. */
  children?: React.ReactNode
  /**
   * Called when this CTA is a form type and the button is clicked.
   * Wire to your modal open handler (e.g. earlyAccess.open / FormModalProvider).
   * If omitted, the button renders but does nothing on click.
   */
  onFormClick?: () => void
  /** Extra props forwarded to the underlying element. */
  [key: string]: unknown
}

function trackClick(internalName: string) {
  // Placeholder — swap for your analytics provider (e.g. Segment, GA4, PostHog).
  // The data-analytics-name attribute is also available for tag managers.
  if (process.env.NODE_ENV !== 'production') {
    console.info('[CTA click]', internalName)
  }
}

export function CtaButton({
  cta,
  className,
  style,
  children,
  onFormClick,
  ...rest
}: CtaButtonProps) {
  if (cta.type === 'none') return null

  const content = children ?? cta.label
  const analyticsProps = {
    'data-internal-name': cta.internalName,
    onClick: () => trackClick(cta.internalName),
  }

  // ── Internal or external link ──────────────────────────────────────────────
  if (cta.type === 'link') {
    if (cta.external) {
      return (
        <a
          href={cta.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          style={style}
          {...analyticsProps}
          {...rest}
        >
          {content}
        </a>
      )
    }
    return (
      <Link
        href={cta.href}
        className={className}
        style={style}
        {...analyticsProps}
        {...(rest as Record<string, unknown>)}
      >
        {content}
      </Link>
    )
  }

  // ── File download ──────────────────────────────────────────────────────────
  if (cta.type === 'download') {
    return (
      <a
        href={cta.href}
        download={cta.fileName ?? true}
        className={className}
        style={style}
        {...analyticsProps}
        {...rest}
      >
        {content}
      </a>
    )
  }

  // ── Form trigger ───────────────────────────────────────────────────────────
  // Renders a button. onFormClick wires to the appropriate modal (e.g.
  // EarlyAccessWrapper for earlyAccess, FormModalProvider for future types).
  if (cta.type === 'form') {
    return (
      <button
        type="button"
        data-form-id={cta.formId}
        data-internal-name={cta.internalName}
        className={className}
        style={style}
        onClick={() => {
          trackClick(cta.internalName)
          onFormClick?.()
        }}
        {...(rest as Record<string, unknown>)}
      >
        {content}
      </button>
    )
  }

  return null
}
