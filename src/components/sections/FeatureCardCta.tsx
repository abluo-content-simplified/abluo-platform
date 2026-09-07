'use client'

import { useParams } from 'next/navigation'
import type { Cta } from '@/lib/sanity/types'
import { resolveCta, prefixCtaHref } from '@/lib/sanity/cta'

/**
 * The per-card link at the foot of a feature card ("Leggi →").
 *
 * A separate client component for the same reason `StepsSection`'s ClosingCta is
 * one: `tenantId` and `locale` are URL params, not stored in Sanity, so the href
 * cannot be resolved on the server. FeatureGridSection itself stays a server
 * component.
 */
export function FeatureCardCta({ cta }: { cta: Cta }) {
  const params = useParams()
  const locale = params?.locale as string | undefined
  const tenantId = params?.tenant as string | undefined

  const resolved = prefixCtaHref(resolveCta(cta), locale, tenantId)
  if (resolved.type !== 'link') return null

  return (
    <a
      href={resolved.href}
      {...(resolved.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="relative z-[1] mt-6 inline-flex items-center gap-2 self-start text-sm font-semibold transition-opacity hover:opacity-75"
      style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-body)' }}
    >
      {resolved.label}
      <span aria-hidden="true">→</span>
    </a>
  )
}
