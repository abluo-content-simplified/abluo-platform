'use client'

/**
 * EarlyAccessContext
 *
 * Shared state for the Early Access form flow.
 * Provides open/close control, prefill data, tenant info, and locale
 * to both the nav CTA and the footer form without prop-drilling.
 *
 * Usage:
 *   <EarlyAccessProvider tenantSlug="livener" locale="it">
 *     ... layout children ...
 *     <EarlyAccessModal />
 *   </EarlyAccessProvider>
 *
 * Then in any client component:
 *   const { open, locale } = useEarlyAccess()
 *   open({ source: 'header_cta' })
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { SanityProjectSlug, UrlProjectSegment } from '@/lib/tenancy/ids'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EarlyAccessOpenOptions {
  /** Prefilled name — from footer form or empty for header CTA */
  name?: string
  /** Prefilled email — from footer form or empty for header CTA */
  email?: string
  /** Which entry point triggered the open */
  source: 'header_cta' | 'footer_cta'
  /** Existing submission ID — if the footer already created a partial submission (ADR-018) */
  submissionId?: string
  /** One-time rotating step token for the existing partial submission (ADR-018) */
  completionToken?: string
  /** Start at step 2 (footer already captured name + email) */
  startAtStep2?: boolean
  /**
   * CTA internal name — stable identifier for attribution and A/B testing.
   * Comes from the `internalName` field on the Sanity CTA object.
   * Example: 'hero-investors-a', 'hero-investors-b', 'footer-contact'
   */
  ctaInternalName?: string
  /**
   * Exact CTA label text shown to the user at the moment of click.
   * Captured as a snapshot for historical analysis and A/B testing.
   * Example: 'Get Early Access', 'Join the Beta', 'Request Early Access'
   */
  ctaLabelSnapshot?: string
}

interface EarlyAccessContextValue {
  isOpen: boolean
  options: EarlyAccessOpenOptions | null
  /**
   * The `[tenant]` URL segment. Despite the name this is NOT a tenant slug:
   * No!Logo's segment is `nologo`, whose tenant is `freeriders`. See
   * `@/lib/tenancy/ids`.
   */
  tenantSlug: UrlProjectSegment
  /**
   * ⚠️ SANITY project slug (`tenantToProjectSlug()`, e.g. 'livener-main') — NOT
   * a Supabase `projects.slug` and NOT the submission route's scope. It does not
   * resolve to a project_id server-side, so nothing here submits under it; the
   * comment that said it did was the reason it looked like the fix for the
   * tenant-slug-in-a-projectSlug-position defect. Left in place for Sanity-side
   * consumers; the submission scope stays the tenant slug until routing supplies
   * a real Supabase project slug (see `projectScopeSlugFromUrlSegment`).
   */
  projectSlug?: SanityProjectSlug
  /** Current locale — used by components to look up localised messages */
  locale: string
  open: (opts: EarlyAccessOpenOptions) => void
  close: () => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const EarlyAccessContext = createContext<EarlyAccessContextValue | null>(null)

export function useEarlyAccess(): EarlyAccessContextValue {
  const ctx = useContext(EarlyAccessContext)
  if (!ctx) throw new Error('useEarlyAccess must be used within EarlyAccessProvider')
  return ctx
}

/**
 * Null-safe variant — returns null when called outside EarlyAccessProvider.
 * Use in reusable section components that may or may not be wrapped by the provider.
 */
export function useEarlyAccessSafe(): EarlyAccessContextValue | null {
  return useContext(EarlyAccessContext)
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface EarlyAccessProviderProps {
  children: ReactNode
  /**
   * The `[tenant]` URL segment. Despite the name this is NOT a tenant slug:
   * No!Logo's segment is `nologo`, whose tenant is `freeriders`. See
   * `@/lib/tenancy/ids`.
   */
  tenantSlug: UrlProjectSegment
  /** Sanity project slug (see the context value's doc) — not the API scope. */
  projectSlug?: SanityProjectSlug
  /** Current page locale — passed through to components for message lookup */
  locale: string
}

export function EarlyAccessProvider({
  children,
  tenantSlug,
  projectSlug,
  locale,
}: EarlyAccessProviderProps) {
  const [isOpen, setIsOpen]   = useState(false)
  const [options, setOptions] = useState<EarlyAccessOpenOptions | null>(null)

  const open = useCallback((opts: EarlyAccessOpenOptions) => {
    setOptions(opts)
    setIsOpen(true)
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    // Keep options briefly so exit animation can finish, then clear
    setTimeout(() => setOptions(null), 350)
  }, [])

  return (
    <EarlyAccessContext.Provider value={{ isOpen, options, tenantSlug, projectSlug, locale, open, close }}>
      {children}
    </EarlyAccessContext.Provider>
  )
}
