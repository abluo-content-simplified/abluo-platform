'use client'

/**
 * Carries the site's enabled module ids (getEnabledModuleIds) to client
 * components rendered inside the `[tenant]` layout — today only the branded
 * unavailable page (ADR-032 D12), which cannot receive params or fetch.
 *
 * Provided once by the `[tenant]` layout. Outside a provider the answer is
 * null — "unknown", which consumers treat as "offer nothing module-specific".
 */

import { createContext, useContext } from 'react'

const SiteModulesContext = createContext<readonly string[] | null>(null)

export function SiteModulesProvider({ moduleIds, children }: { moduleIds: string[] | null; children: React.ReactNode }) {
  return <SiteModulesContext.Provider value={moduleIds}>{children}</SiteModulesContext.Provider>
}

export function useEnabledModuleIds(): readonly string[] | null {
  return useContext(SiteModulesContext)
}
