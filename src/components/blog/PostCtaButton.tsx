'use client'

import { useParams } from 'next/navigation'
import { useHostScoped } from '@/components/SiteLinkScope'
import { FormOverlayWrapper } from '@/components/forms/FormOverlayWrapper'
import { FormOverlayTrigger } from '@/components/forms/FormOverlayTrigger'
import { overlayButtonClass } from '@/lib/forms/overlay-button'
import { withTenantPrefix } from '@/lib/sanity/href'
import type { PostCtaTarget } from '@/lib/blog/post-cta'
import type { RenderableFormDefinition } from '@/lib/sanity/types'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'

/**
 * The button of a post's call to action, styled with the site's own Design
 * System button tokens (same classes as the Form Button section). Internal
 * links get the locale/tenant prefix the same way every section CTA does;
 * tel / mailto / WhatsApp / external URLs pass through; a form opens in the
 * site's standard form pop-up.
 */
export function PostCtaButton({
  target,
  label,
  internalName,
  form,
  tenantSlug,
  locale,
}: {
  target: PostCtaTarget
  label: string
  internalName: string
  /** The resolved form definition when `target.kind === 'form'`. */
  form?: RenderableFormDefinition | null
  tenantSlug: UrlProjectSegment
  locale: string
}) {
  const params = useParams()
  const hostScoped = useHostScoped()
  const className = overlayButtonClass('primary')

  if (target.kind === 'form') {
    if (!form) return null
    return (
      <FormOverlayWrapper tenantSlug={tenantSlug} locale={locale} forms={[{ formId: target.formId, definition: form }]}>
        <FormOverlayTrigger
          formId={target.formId}
          source={{ source: 'post_cta', cta_internal_name: internalName, cta_label_snapshot: label }}
          className={className}
        >
          {label}
        </FormOverlayTrigger>
      </FormOverlayWrapper>
    )
  }

  const href = target.internal
    ? withTenantPrefix(target.href, (params?.locale as string) ?? locale, (params?.tenant as string) ?? tenantSlug, hostScoped)
    : target.href
  return (
    <a
      href={href}
      className={className}
      data-internal-name={internalName}
      {...(target.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  )
}
