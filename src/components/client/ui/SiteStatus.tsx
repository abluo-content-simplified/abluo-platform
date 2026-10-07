import { useTranslations } from 'next-intl'
import { LinkCard } from '@/components/client/ui/LinkCard'

export type SiteStatusState = 'live' | 'preview' | 'offline'

/**
 * The site's address and whether it is live, with "View your site". Read-only:
 * it shows the state, never a setting. `url` null → not served anywhere yet,
 * so the card is not a link.
 */
export function SiteStatus({ state, host, url }: { state: SiteStatusState; host: string | null; url: string | null }) {
  const t = useTranslations('clientDashboard.ui.siteStatus')
  const chip = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium ${
        state === 'live' ? 'border-border text-foreground' : 'border-dashed border-border text-muted-foreground'
      }`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${state === 'live' ? 'bg-success' : 'bg-muted-foreground'}`} />
      {t(`state.${state}`)}
    </span>
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
