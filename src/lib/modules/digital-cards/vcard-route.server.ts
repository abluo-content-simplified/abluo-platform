// ── Digital Cards — Save contact (ADR-049 D9) ─────────────────────────────────
//
// The two GET route handlers (`/link/contact.vcf`, `/link/<name>/contact.vcf`)
// share this. The vCard is generated on request from the same published data
// and switches as the card; nothing is stored. Bot user agents → 403 before
// any read; module off / card offline / Save contact off / nothing to save →
// 404; a best-effort per-instance rate limit per card (no IP is read) → 429.
// A retired person-card name → 308 to the current name's vCard.

import { canonicalOrigin } from '@/lib/seo/canonical'
import { buildVCard, resolveShow } from './model'
import { cardRequestContext } from './page.server'
import {
  createFixedWindowLimiter,
  isBotUserAgent,
  loadPersonCard,
  loadSiteCard,
  personVCardInput,
  siteVCardInput,
  vcardDecision,
  vcardFileName,
  vcardHasContent,
} from './website'

/** Per instance and card: generous for people, a wall for a script. */
const limiter = createFixedWindowLimiter({ limit: 30, windowMs: 60_000 })

const BASE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } as const

function status(code: 403 | 404 | 429): Response {
  return new Response(null, { status: code, headers: { ...BASE_HEADERS, ...(code === 429 ? { 'Retry-After': '60' } : {}) } })
}

export async function serveCardVCard(request: Request, params: { tenant: string; locale: string; name?: string }): Promise<Response> {
  const userAgent = request.headers.get('user-agent')
  if (isBotUserAgent(userAgent)) return status(403)

  const ctx = await cardRequestContext(params.tenant, params.locale)
  if (!ctx) return status(404)
  const load = { locale: params.locale, defaultLocale: ctx.defaultLocale, enabledModuleIds: ctx.enabledModuleIds, siteBase: ctx.siteBase }

  let saveContact: boolean | null = null
  let vcard = ''
  let fileName = 'contact.vcf'
  let cardId = ''
  if (params.name === undefined) {
    const outcome = await loadSiteCard(ctx.fetchForTenant, load)
    if (outcome.kind === 'render') {
      const card = outcome.card
      const input = siteVCardInput(card, canonicalOrigin(card.project?.customDomain))
      saveContact = resolveShow('site', card.show).saveContact
      vcard = vcardHasContent(input) ? buildVCard(input) : ''
      fileName = vcardFileName(card.site?.siteName)
      cardId = card.publicId
    }
  } else {
    const outcome = await loadPersonCard(ctx.fetchForTenant, { ...load, urlName: params.name })
    if (outcome.kind === 'redirect' && outcome.permanent) {
      return new Response(null, { status: 308, headers: { ...BASE_HEADERS, Location: `${outcome.to}/contact.vcf` } })
    }
    if (outcome.kind === 'render') {
      const card = outcome.card
      const input = personVCardInput(card, canonicalOrigin(card.project?.customDomain))
      saveContact = resolveShow('person', card.show).saveContact
      vcard = vcardHasContent(input) ? buildVCard(input) : ''
      fileName = vcardFileName(input.fullName ?? card.urlName)
      cardId = card.publicId
    }
  }

  const decision = vcardDecision({
    userAgent,
    moduleOn: true, // the loaders already returned not-found when the module is off
    saveContact,
    hasContent: vcard.length > 0,
    withinRateLimit: saveContact === true && vcard ? limiter.take(`${ctx.tenantId}:${cardId}`) : true,
  })
  if (decision.kind === 'forbidden') return status(403)
  if (decision.kind === 'not-found') return status(404)
  if (decision.kind === 'rate-limited') return status(429)
  return new Response(vcard, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
