'use client'

// ─── Cookie consent — client state (ADR-021) ─────────────────────────────────
//
// Holds the visitor's record for ONE site, writes the per-site cookie, renders
// the banner, and lets the footer link and click-to-load embeds reach it.
//
// Newly granted SCRIPT purposes take effect with one reload: the server then
// renders the scripts, which is the single code path that loads tracking
// (inline scripts inserted after hydration would not execute). Granting
// External content needs no reload — every ConsentEmbed re-renders from the
// new record and mounts its iframe in place. Rejecting never reloads.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  CONSENT_COOKIE_MAX_AGE_S,
  allowVendor as allowVendorIn,
  allowedVendorIds,
  applyChoice,
  applyVendorChoices,
  choiceNeedsReload,
  embedAllowed,
  embedVendorName,
  grantsFrom,
  serializeConsentCookie,
  type ConsentPolicy,
  type ConsentPurpose,
  type ConsentRecord,
} from '@/lib/consent'
import { CookieBanner } from './CookieBanner'
import type { MotionTokens } from '@/lib/sanity/types'

interface ConsentContextValue {
  /** Footer "Cookie settings" link: the site needs consent, or the visitor allowed an embed. */
  showSettingsLink: boolean
  openSettings: () => void
  isVendorLoaded: (vendorId: string) => boolean
  loadVendor: (vendorId: string, always: boolean) => void
  locale: string
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

export function useConsent(): ConsentContextValue | null {
  return useContext(ConsentContext)
}

export interface ConsentProviderProps {
  children: React.ReactNode
  cookieName: string
  policy: ConsentPolicy
  record: ConsentRecord | null
  showBanner: boolean
  requiresConsent: boolean
  locale: string
  /** Resolved href of the tenant's cookie-policy page; hidden when absent. */
  policyHref?: string
  /** Non-production only: `?consent=reset` clears the cookie for QA. */
  allowReset?: boolean
  /** Design-system motion tokens for the banner entrance. */
  motionTokens?: MotionTokens
}

function writeCookie(name: string, record: ConsentRecord | null) {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = record
    ? `${name}=${serializeConsentCookie(record)}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE_S}; SameSite=Lax${secure}`
    : `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
}

export function ConsentProvider({
  children,
  cookieName,
  policy,
  record: initialRecord,
  showBanner,
  requiresConsent,
  locale,
  policyHref,
  allowReset = false,
  motionTokens,
}: ConsentProviderProps) {
  const [record, setRecord] = useState<ConsentRecord | null>(initialRecord)
  const [open, setOpen] = useState<null | 'first' | 'settings'>(showBanner ? 'first' : null)
  // Embeds loaded once for this page view without "always allow".
  const [sessionVendors, setSessionVendors] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!allowReset) return
    const url = new URL(window.location.href)
    if (url.searchParams.get('consent') !== 'reset') return
    // Clear the choice in place — no reload (a reload flashes a blank page).
    // State is reset in the next frame: we are syncing React to an external
    // change (the URL + cookie), not deriving state during render.
    writeCookie(cookieName, null)
    url.searchParams.delete('consent')
    window.history.replaceState(window.history.state, '', url.toString())
    const frame = requestAnimationFrame(() => {
      setRecord(null)
      setSessionVendors(new Set())
      setOpen(requiresConsent ? 'first' : null)
    })
    return () => cancelAnimationFrame(frame)
  }, [allowReset, cookieName, requiresConsent])

  const choose = useCallback(
    (choice: Partial<Record<ConsentPurpose, boolean>>, vendorChoices?: Record<string, boolean>) => {
      const before = grantsFrom(record, policy)
      let next = applyChoice(record, policy, choice)
      if (vendorChoices) {
        next = applyVendorChoices(next, vendorChoices)
        const withdrawn = Object.keys(vendorChoices).filter((id) => !vendorChoices[id])
        if (withdrawn.length) {
          setSessionVendors((s) => {
            const n = new Set(s)
            withdrawn.forEach((id) => n.delete(id))
            return n
          })
        }
      }
      writeCookie(cookieName, next)
      setRecord(next)
      setOpen(null)
      if (choiceNeedsReload(before, grantsFrom(next, policy))) window.location.reload()
    },
    [record, policy, cookieName]
  )

  const loadVendor = useCallback(
    (vendorId: string, always: boolean) => {
      setSessionVendors((s) => new Set(s).add(vendorId))
      if (always) {
        const next = allowVendorIn(record, vendorId)
        writeCookie(cookieName, next)
        setRecord(next)
      }
    },
    [record, cookieName]
  )

  const allowedVendors = allowedVendorIds(record)
  const showSettings = requiresConsent || allowedVendors.length > 0

  const value = useMemo<ConsentContextValue>(
    () => ({
      showSettingsLink: showSettings,
      openSettings: () => setOpen('settings'),
      // Loaded this page view, always-allowed, or covered by an External
      // content grant that lists this vendor (embedAllowed).
      isVendorLoaded: (id) => sessionVendors.has(id) || embedAllowed(record, policy, id),
      loadVendor,
      locale,
    }),
    [showSettings, sessionVendors, record, policy, loadVendor, locale]
  )

  return (
    <ConsentContext.Provider value={value}>
      {children}
      {showSettings && (
        <CookieBanner
          open={open}
          onOpenSettings={() => setOpen('settings')}
          onChoose={choose}
          policy={policy}
          grants={grantsFrom(record, policy)}
          vendors={allowedVendors.map((id) => ({ id, name: embedVendorName(id) }))}
          locale={locale}
          policyHref={policyHref}
          motionTokens={motionTokens}
        />
      )}
    </ConsentContext.Provider>
  )
}
