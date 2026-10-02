/**
 * Is this request serving a site on its OWN host?
 *
 * On a project's custom domain (and any other host that resolves to exactly
 * one project) the proxy accepts `/{locale}/…` and rewrites it to the internal
 * `/{locale}/{project}/…`. On the platform's path-based surfaces
 * (`preview.abluo.app/<project>`, `dev.abluo.app/<project>`) the project
 * segment is part of the public URL. Links must be emitted in the form the
 * visitor's host serves canonically — see siteBasePath() in
 * `@/lib/sanity/href`.
 *
 * True only when the host resolves to a project AND that project is the one in
 * the `[tenant]` segment: `dev.abluo.app` resolves to the platform's own site,
 * but `dev.abluo.app/en/livener` is Livener reached by path, so its links keep
 * the segment.
 *
 * Pure and edge-safe. The server wrapper is `isHostScopedRequest()` in
 * `./link-scope.server`; client components read `useHostScoped()`.
 */

import { resolveScopeFromHost } from './host-scope'
import { unbrand } from './ids'

export function isHostScopedSegment(host: string | null | undefined, segment: string | null | undefined): boolean {
  if (!segment) return false
  const scope = resolveScopeFromHost(host)
  return !!scope && unbrand(scope.projectSlug) === segment
}
