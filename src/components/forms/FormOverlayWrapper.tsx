'use client'

/**
 * FormOverlayWrapper — ADR-018 slice 7a.
 *
 * Client boundary that mounts the generic form-overlay system once near the
 * layout root: the provider (state) wrapping the page content, plus the host
 * (the single FormModal render point). A Server Component parent resolves the
 * overlay-openable definitions and passes them in as `forms`, exactly as the
 * bespoke EarlyAccessWrapper pattern does for Early Access.
 *
 * Mounting is additive: pages without any overlay trigger simply never open it,
 * and the host is inert. This wrapper is independent of EarlyAccessWrapper — a
 * layout may use either, both, or neither.
 */

import type { ReactNode } from 'react'
import { FormOverlayProvider } from './FormOverlayContext'
import { FormOverlayHost } from './FormOverlayHost'
import type { OverlayFormEntry } from '@/lib/forms/overlay'

interface FormOverlayWrapperProps {
  children: ReactNode
  tenantSlug: string
  locale: string
  /** Server-resolved definitions any trigger in the tree may open. */
  forms: readonly OverlayFormEntry[]
}

export function FormOverlayWrapper({ children, tenantSlug, locale, forms }: FormOverlayWrapperProps) {
  return (
    <FormOverlayProvider tenantSlug={tenantSlug} locale={locale} forms={forms}>
      {children}
      <FormOverlayHost />
    </FormOverlayProvider>
  )
}
