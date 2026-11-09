import type { Metadata } from 'next'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { CardPage } from '@/components/digital-cards/CardPage'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { ogImageUrl } from '@/lib/sanity/image'
import { cardShareMeta, personCardView, withSource } from '@/lib/modules/digital-cards/website'
import { CARD_NOINDEX_METADATA, cardMetadata, loadPersonCardForRequest } from '@/lib/modules/digital-cards/page.server'

// ── /link/<name> — a person card (ADR-049 D2, D5, D6, D7) ─────────────────────
// Live card → render. Person gone / off / anonymised / archived, or the card
// unpublished / archived → /link (temporary). A retired name → 308 to the
// current one. Anything else → 404. Rendered in the bare card layout.

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string; name: string }>
  /** Only `?src=` is read: kept across a redirect so a QR scan still counts as `qr`. */
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant, locale, name } = await params
  const { ctx, outcome } = await loadPersonCardForRequest(tenant, locale, name)
  if (!ctx || outcome.kind !== 'render') return CARD_NOINDEX_METADATA
  const messages = getDigitalCardSiteMessages(locale)
  const view = personCardView(outcome.card, { locale, siteBase: ctx.siteBase, messages })
  const share = cardShareMeta(view, outcome.card.site?.siteName, messages)
  return cardMetadata(share, share.image ? ogImageUrl(share.image) : undefined)
}

export default async function PersonCardPage({ params, searchParams }: PageProps) {
  const { tenant, locale, name } = await params
  const { ctx, outcome } = await loadPersonCardForRequest(tenant, locale, name)
  if (!ctx || outcome.kind === 'not-found') notFound()
  if (outcome.kind === 'redirect') {
    const to = withSource(outcome.to, (await searchParams)?.src)
    if (outcome.permanent) permanentRedirect(to)
    redirect(to)
  }
  const messages = getDigitalCardSiteMessages(locale)
  const view = personCardView(outcome.card, { locale, siteBase: ctx.siteBase, messages })
  return <CardPage ctx={ctx} view={view} messages={messages} />
}
