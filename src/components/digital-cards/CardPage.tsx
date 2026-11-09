import { DigitalCardView } from './DigitalCardView'
import { cardCountable, cardDesignSystem, cardLegalLinks, type CardRequestContext } from '@/lib/modules/digital-cards/page.server'
import type { CardView } from '@/lib/modules/digital-cards/website'
import type { DigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'

/** Both /link pages: the view model plus what every card shows around it (legal footer, motion, counting). */
export async function CardPage({ ctx, view, messages }: { ctx: CardRequestContext; view: CardView; messages: DigitalCardSiteMessages }) {
  const [legalLinks, designSystem, countable] = await Promise.all([cardLegalLinks(ctx), cardDesignSystem(ctx), cardCountable(ctx)])
  return (
    <DigitalCardView
      view={view}
      messages={messages}
      legalLinks={legalLinks}
      projectSlug={ctx.tenantId}
      countable={countable}
      motion={designSystem?.motion ?? null}
    />
  )
}
