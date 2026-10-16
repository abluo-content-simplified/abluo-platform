// ── Where a project's public pages are reachable from the host you are on ─────
//
// Production: the project's own domain. On the platform's path-served hosts
// (dev.abluo.app, preview.abluo.app) the project's pages live at
// `https://<host>/<project>/…` (proxy.ts adds the default language), and the
// custom domain would point at production, which may not have the content yet.
// Pure: no I/O.

import { lookupHostRoute, normalizeHost } from '@/lib/tenancy/host-scope'

/** `https://dev.abluo.app/tmz` when `requestHost` serves any project by path; null on every other host. */
export function pathServedBase(requestHost: string | null | undefined, projectSlug: string, proto: 'https' | 'http' = 'https'): string | null {
  const host = normalizeHost(requestHost)
  if (!host || !projectSlug) return null
  const pathServed = host === 'preview.abluo.app' || lookupHostRoute(host)?.hostKind === 'platform-alias'
  return pathServed ? `${proto}://${host}/${encodeURIComponent(projectSlug)}` : null
}
