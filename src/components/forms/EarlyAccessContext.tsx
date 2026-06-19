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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EarlyAccessOpenOptions {
  /** Prefilled name — from footer form or empty for header CTA */
  name?: string
  /** Prefilled email — from footer form or empty for header CTA */
  email?: string
  /** Which entry point triggered the open */
  source: 'header_cta' | 'footer_cta'
  /** Existing inquiry ID — if the footer already created a partial record */
  inquiryId?: string
  /** Start at step 2 (footer already captured name + email) */
  startAtStep2?: boolean
}

interface EarlyAccessContextValue {
  isOpen: boolean
  options: EarlyAccessOpenOptions | null
  tenantSlug: string
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

// ─── Provider ─────────────────────────────────────────────────────────────────

interface EarlyAccessProviderProps {
  children: ReactNode
  tenantSlug: string
  /** Current page locale — passed through to components for message lookup */
  locale: string
}

export function EarlyAccessProvider({
  children,
  tenantSlug,
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
    <EarlyAccessContext.Provider value={{ isOpen, options, tenantSlug, locale, open, close }}>
      {children}
    </EarlyAccessContext.Provider>
  )
}
