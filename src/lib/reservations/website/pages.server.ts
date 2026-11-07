import 'server-only'
// ── Reservations website — the page loaders (ADR-044 D11) ────────────────────
// What the two route files call. Each returns ONE of four states; the page
// renders the same calm "link not valid" screen for `invalid`, whatever the
// reason (malformed, unknown, another site's, module off, anonymised).
import { lookupBookingLink, lookupPassLink } from './link-guard'
import { loadBookingView, loadPassView } from './data'
import { withWebsiteContext } from './context.server'
import type { BookingView, PassView } from './types'

export type PageState<V> = { kind: 'ok'; view: V } | { kind: 'invalid' } | { kind: 'limited' } | { kind: 'unavailable' }

export async function loadBookingPage(input: { tenant: string; locale: string; token: string }): Promise<PageState<BookingView>> {
  const out = await withWebsiteContext(input, async (ctx): Promise<PageState<BookingView>> => {
    const link = await lookupBookingLink(ctx.service.store, { projectId: ctx.projectId, token: input.token, ipHash: ctx.ipHash })
    if (link.kind !== 'ok') return { kind: link.kind }
    const v = await loadBookingView(ctx, link.value)
    if (!v.ok) return { kind: v.code === 'not_found' ? 'invalid' : 'unavailable' }
    return { kind: 'ok', view: v.value.view }
  })
  return out.kind === 'ok' ? out.value : { kind: out.kind }
}

export async function loadPassPage(input: { tenant: string; locale: string; token: string }): Promise<PageState<PassView>> {
  const out = await withWebsiteContext(input, async (ctx): Promise<PageState<PassView>> => {
    const link = await lookupPassLink(ctx.service.store, { projectId: ctx.projectId, token: input.token, ipHash: ctx.ipHash })
    if (link.kind !== 'ok') return { kind: link.kind }
    const v = await loadPassView(ctx, link.value)
    if (!v.ok) return { kind: v.code === 'not_found' ? 'invalid' : 'unavailable' }
    return { kind: 'ok', view: v.value.view }
  })
  return out.kind === 'ok' ? out.value : { kind: out.kind }
}
