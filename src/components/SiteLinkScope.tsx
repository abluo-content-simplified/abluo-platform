'use client'

/**
 * Carries one server-computed fact to client components: is this site being
 * served on its own host? When it is, internal links drop the project segment
 * (`/en/news`, not `/en/abluo/news`). See siteBasePath() in
 * `@/lib/sanity/href` and `@/lib/tenancy/link-scope`.
 *
 * Provided once by the `[tenant]` layout. Outside a provider the answer is
 * false — the path-based form, which every host can route.
 */

import { createContext, useContext } from 'react'

const SiteLinkScopeContext = createContext(false)

export function SiteLinkScopeProvider({ hostScoped, children }: { hostScoped: boolean; children: React.ReactNode }) {
  return <SiteLinkScopeContext.Provider value={hostScoped}>{children}</SiteLinkScopeContext.Provider>
}

export function useHostScoped(): boolean {
  return useContext(SiteLinkScopeContext)
}
