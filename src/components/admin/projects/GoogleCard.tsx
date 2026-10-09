import { getTranslations } from 'next-intl/server'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { getAdminGoogleCard } from '@/lib/admin/google'
import { GoogleSetupPanel } from './GoogleSetupPanel'

/**
 * "Google" on the admin project page: Analytics and Search Console, each
 * Connected / Not set up / Waiting for site / Error, and the buttons that set
 * them up with the Abluo service account (docs/engineering/analytics-setup.md
 * → Automatic setup). Server component: requireAbluoAdmin() runs inside
 * getAdminGoogleCard; renders nothing when refused or the project is unknown.
 * Anchor `#google` — the new-project wizard links here as the next step.
 */
export async function GoogleCard({ projectId }: { projectId: string }) {
  const data = await getAdminGoogleCard(projectId).catch((e) => {
    console.warn(`[admin/google] card: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })
  if (!data) return null
  const t = await getTranslations('admin.projectPage.google')
  return (
    <section id="google" aria-labelledby="google-heading" className="flex scroll-mt-6 flex-col gap-3">
      <div className="space-y-1">
        <SectionHeading id="google-heading" title={t('heading')} />
        <p className="text-sm leading-5 text-muted-foreground">{t('body')}</p>
      </div>
      <GoogleSetupPanel projectId={projectId} initial={data.card} env={data.env} hasDomain={data.hasDomain} loaded={data.loaded} />
    </section>
  )
}
