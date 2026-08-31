'use client'

/**
 * FormOverlayContext — ADR-018 slice 7a.
 *
 * Generic overlay state for definition-driven forms: which form is open, the
 * open/close controls, and the per-request context/title. Provided once near
 * the layout root (see FormOverlayWrapper) and consumed by any trigger via
 * `useFormOverlay()` / `useFormOverlaySafe()` — no prop-drilling.
 *
 * This is the reusable-module analogue of EarlyAccessContext, kept entirely
 * separate so the bespoke Early Access overlay is untouched and the two never
 * share state. The pre-resolved `forms` list is seeded server-side and looked
 * up by `formId` when a trigger fires (see overlay.ts).
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { OverlayFormEntry, OverlayOpenRequest } from '@/lib/forms/overlay'
import type { UrlProjectSegment } from '@/lib/tenancy/ids'

interface FormOverlayContextValue {
  /** The active open request, or null when the overlay is closed. */
  request: OverlayOpenRequest | null
  /** URL tenant slug — the submission route scope, forwarded to renderers. */
  /**
   * The `[tenant]` URL segment. Despite the name this is NOT a tenant slug:
   * No!Logo's segment is `nologo`, whose tenant is `freeriders`. See
   * `@/lib/tenancy/ids`.
   */
  tenantSlug: UrlProjectSegment
  /** Current locale — drives renderer + chrome message lookup. */
  locale: string
  /** Server-resolved forms this provider can open, keyed by formId. */
  forms: readonly OverlayFormEntry[]
  open: (req: OverlayOpenRequest) => void
  close: () => void
}

const FormOverlayContext = createContext<FormOverlayContextValue | null>(null)

/** Throws when used outside a provider — for components that require the overlay. */
export function useFormOverlay(): FormOverlayContextValue {
  const ctx = useContext(FormOverlayContext)
  if (!ctx) throw new Error('useFormOverlay must be used within FormOverlayProvider')
  return ctx
}

/**
 * Null-safe variant for reusable components (triggers, nav CTAs) that may render
 * on tenants/pages without the provider mounted. Returns null instead of throwing.
 */
export function useFormOverlaySafe(): FormOverlayContextValue | null {
  return useContext(FormOverlayContext)
}

interface FormOverlayProviderProps {
  children: ReactNode
  /**
   * The `[tenant]` URL segment. Despite the name this is NOT a tenant slug:
   * No!Logo's segment is `nologo`, whose tenant is `freeriders`. See
   * `@/lib/tenancy/ids`.
   */
  tenantSlug: UrlProjectSegment
  locale: string
  forms: readonly OverlayFormEntry[]
}

export function FormOverlayProvider({ children, tenantSlug, locale, forms }: FormOverlayProviderProps) {
  const [request, setRequest] = useState<OverlayOpenRequest | null>(null)

  const open = useCallback((req: OverlayOpenRequest) => setRequest(req), [])
  const close = useCallback(() => setRequest(null), [])

  const value = useMemo<FormOverlayContextValue>(
    () => ({ request, tenantSlug, locale, forms, open, close }),
    [request, tenantSlug, locale, forms, open, close],
  )

  return <FormOverlayContext.Provider value={value}>{children}</FormOverlayContext.Provider>
}
