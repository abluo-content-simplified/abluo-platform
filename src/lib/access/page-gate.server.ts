/**
 * Site Access — the page gate wired to the request (server only).
 *
 * `loadGatedPage()` is the ONE way the page route reads a page:
 *   1. pageBySlugQuery with `$unlocked: false` — a restricted page comes back
 *      with routing data and its policy only; title, SEO and sections never
 *      leave Sanity;
 *   2. decidePageGate() — no database call at all for a public page;
 *   3. only when granted: the same query with `$unlocked: true`.
 * React `cache()` shares one decision between generateMetadata() and the page
 * within a request; nothing is cached across requests (the route is
 * force-dynamic and every response is `Cache-Control: no-store`).
 */
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { tenantClient } from '@/lib/sanity/client'
import { pageBySlugQuery } from '@/lib/sanity/queries'
import type { WebsitePage } from '@/lib/sanity/types'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { accessEnvironment, withSiteAccessStore } from './server'
import { decidePageGate, type PageGate, type PageGateDeps } from './page-gate'
import { slugAncestorPaths } from './policy'
import { sessionCookieName } from './session-token'
import { isSecureAccessRequest } from './request'
import { resolveVisitor } from './visitor'

export type GatedPage = { page: WebsitePage | null; gate: PageGate | null }

async function requestIsSecure(): Promise<boolean> {
  return isSecureAccessRequest(await headers())
}

/**
 * Lazy: cookies() and headers() are read only when a restricted page actually
 * needs the visitor — a public page touches neither (and stays exactly as it
 * was before Access existed).
 */
function requestDeps(): PageGateDeps {
  return {
    projectIdFor: (segment) => resolveScopeFromProjectSegment(segment)?.projectId ?? null,
    environment: accessEnvironment,
    readToken: async (projectId) => {
      const [jar, secure] = await Promise.all([cookies(), requestIsSecure()])
      return jar.get(sessionCookieName(projectId, secure))?.value ?? null
    },
    resolveVisitor: async (projectId, environment, token) => {
      if (!token) return null
      try {
        return await withSiteAccessStore('page gate: resolve the visitor session for a restricted page', (store) =>
          resolveVisitor({ store, projectId, environment, token })
        )
      } catch {
        return null
      }
    },
  }
}

export const loadGatedPage = cache(async function loadGatedPage(
  tenantSegment: string,
  locale: string,
  defaultLocale: string,
  slug: string,
  enabledModuleIds: readonly string[] | null
): Promise<GatedPage> {
  const { fetchForTenant } = tenantClient(asUrlProjectSegment(tenantSegment))
  const params = { locale, defaultLocale, slug, ancestorPaths: slugAncestorPaths(slug) }
  const first = await fetchForTenant<WebsitePage | null>(pageBySlugQuery, { ...params, unlocked: false })
  if (!first) return { page: null, gate: null }

  const gate = await decidePageGate(first, { projectSegment: tenantSegment, enabledModuleIds }, requestDeps())
  if (gate.kind !== 'granted') return { page: first, gate }

  const full = await fetchForTenant<WebsitePage | null>(pageBySlugQuery, { ...params, unlocked: true })
  // Same document or nothing: a page renamed between the two reads is not served.
  return full && full._id === first._id ? { page: full, gate } : { page: first, gate: { kind: 'denied', reason: 'inconsistent', navigation: 'hidden', visitor: 'none' } }
})

/**
 * What the sign-in page may say about this browser on this project (never
 * about any page or file): no cookie, a cookie that no longer opens anything,
 * or a live session (whose groups did not cover what was asked for).
 */
export async function visitorStateFor(tenantSegment: string): Promise<'none' | 'ended' | 'other_groups'> {
  const deps = requestDeps()
  const projectId = deps.projectIdFor(tenantSegment)
  if (!projectId) return 'none'
  const token = await deps.readToken(projectId)
  if (!token) return 'none'
  return (await deps.resolveVisitor(projectId, deps.environment(), token)) ? 'other_groups' : 'ended'
}

