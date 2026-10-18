import { useTranslations } from 'next-intl'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { Pill } from '@/components/app/ui/list/cells'

export type SiteStatusState = 'live' | 'preview' | 'offline'

/**
 * The site's address and whether it is live, with "View your site". Read-only:
 * it shows the state, never a setting. `url` null → not served anywhere yet,
 * so the card is not a link.
 */
export function SiteStatus({ state, host, url }: { state: SiteStatusState; host: string | null; url: string | null }) {
  const t = useTranslations('clientDashboard.ui.siteStatus')
  const chip = (
    <Pill
      tone={state === 'live' ? 'success' : 'outline'}
      icon={<span aria-hidden="true" className={`size-1.5 rounded-full ${state === 'live' ? 'bg-success' : 'bg-muted-foreground'}`} />}
    >
      {t(`state.${state}`)}
    </Pill>
  )
  return (
    <LinkCard
      href={url}
      external
      title={url ? t(state === 'preview' ? 'viewPreview' : 'viewSite') : t('yourSite')}
      badge={chip}
      subline={host ?? t('notOnlineBody')}
      icon={
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
      }
    />
  )
}
