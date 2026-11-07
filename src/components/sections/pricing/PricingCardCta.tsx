'use client'

import { useParams } from 'next/navigation'
import type { Cta } from '@/lib/sanity/types'
import { resolveCta, prefixCtaHref } from '@/lib/sanity/cta'
import { useHostScoped } from '@/components/SiteLinkScope'
import { CtaButton } from '@/components/ui/CtaButton'
import { useFormOverlaySafe } from '@/components/forms/FormOverlayContext'

/**
 * A pricing card's button. Client-side for the same reason as CtaBannerSection's
 * CtaRow: locale and tenant are URL params, and form CTAs open the form overlay.
 *
 * Colours come from the design system's button tokens (Tom, 2026-11-06: buttons
 * are styled once in the DS, never per section): `primary` for the highlighted
 * card, `secondary` for the others. `link` renders a text link (compact cards).
 */
export function PricingCardCta({ cta, variant }: { cta: Cta; variant: 'primary' | 'secondary' | 'link' }) {
  const params = useParams()
  const locale = params?.locale as string | undefined
  const tenantId = params?.tenant as string | undefined
  const hostScoped = useHostScoped()
  const formOverlay = useFormOverlaySafe()

  const resolved = prefixCtaHref(resolveCta(cta), locale, tenantId, hostScoped)
  if (resolved.type === 'none') return null

  const onFormClick =
    resolved.type === 'form' && resolved.formId && formOverlay
      ? () =>
          formOverlay.open({
            formId: resolved.formId as string,
            ...(resolved.context ? { context: resolved.context } : {}),
            source: { source: 'pricing_cards_section', cta_internal_name: resolved.internalName ?? null, cta_label_snapshot: resolved.label ?? null },
          })
      : undefined

  if (variant === 'link') {
    return (
      <CtaButton
        cta={resolved}
        onFormClick={onFormClick}
        className="inline-flex items-center gap-2 self-start text-sm font-semibold transition-opacity hover:opacity-75"
        style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-body)' }}
      >
        {resolved.label}
        <span aria-hidden="true">→</span>
      </CtaButton>
    )
  }

  const primary = variant === 'primary'
  return (
    <CtaButton
      cta={resolved}
      onFormClick={onFormClick}
      className="flex w-full items-center justify-center px-4 py-3 text-base font-semibold transition-opacity hover:opacity-90"
      style={{
        backgroundColor: primary ? 'var(--btn-primary-bg)' : 'var(--btn-secondary-bg)',
        color: primary ? 'var(--btn-primary-text)' : 'var(--btn-secondary-text)',
        borderRadius: 'var(--radius-btn)',
        border: primary ? '1px solid transparent' : '1px solid var(--color-border)',
        fontFamily: 'var(--font-body)',
      }}
    />
  )
}
