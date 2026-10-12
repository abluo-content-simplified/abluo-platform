/**
 * ADR-032 D12 — every tenant 404 (scheduled, unpublished, archived, deleted
 * or never-existing content, unmatched paths) renders the branded unavailable
 * page inside this segment's layout. Next answers 404 for non-streamed
 * responses; this tree has no loading.tsx, so responses are not streamed.
 *
 * not-found.tsx receives no params; UnavailablePage reads the URL and the
 * layout's providers on its own. 404s raised by the layout itself (unknown
 * project segment, locale not enabled for the project) happen above this
 * boundary and keep the platform default.
 */

import { UnavailablePage } from '@/components/site/UnavailablePage'

export default function TenantNotFound() {
  return <UnavailablePage />
}
