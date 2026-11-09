import type { Metadata } from 'next'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { CardPage } from '@/components/digital-cards/CardPage'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { ogImageUrl } from '@/lib/sanity/image'
import { cardShareMeta, siteCardView, withSource } from '@/lib/modules/digital-cards/website'
import { CARD_NOINDEX_METADATA, cardMetadata, loadSiteCardForRequest } from '@/lib/modules/digital-cards/page.server'

// ── /link — the site card (ADR-049 D2, D6, D7) ────────────────────────────────
// Rendered in the bare card layout (the proxy marks /link…, [tenant]/layout.tsx
// reads the marker). Module not installed or no site card → 404; a site card
// that is unpublished / archived → the homepage (D6: never a dead end).

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ tenant: string; locale: string }>
  /** Only `?src=` is read: kept across a redirect so a QR scan still counts as `qr`. */
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenant, locale } = await params
  const { ctx, outcome } = await loadSiteCardForRequest(tenant, locale)
  if (!ctx || outcome.kind !== 'render') return CARD_NOINDEX_METADATA
  const messages = getDigitalCardSiteMessages(locale)
  const view = siteCardView(outcome.card, { locale, siteBase: ctx.siteBase, messages })
  const share = cardShareMeta(view, outcome.card.site?.siteName, messages)
  return cardMetadata(share, share.image ? ogImageUrl(share.image) : undefined)
}

export default async function SiteCardPage({ params, searchParams }: PageProps) {
  const { tenant, locale } = await params
  const { ctx, outcome } = await loadSiteCardForRequest(tenant, locale)
  if (!ctx || outcome.kind === 'not-found') notFound()
  if (outcome.kind === 'redirect') {
    const to = withSource(outcome.to, (await searchParams)?.src)
    if (outcome.permanent) permanentRedirect(to)
    redirect(to)
  }
  const messages = getDigitalCardSiteMessages(locale)
  const view = siteCardView(outcome.card, { locale, siteBase: ctx.siteBase, messages })
  return <CardPage ctx={ctx} view={view} messages={messages} />
}
