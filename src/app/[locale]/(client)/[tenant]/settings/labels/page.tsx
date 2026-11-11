import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { buildClientNavItems, resolveProjectGrant } from '@/lib/modules/client-navigation'
import { CUSTOM_LABEL_IDS, labelLocales } from '@/lib/nav-labels/model'
import { NAV_LABELS_WRITE, loadNavLabels } from '@/lib/nav-labels/service'
import { NavLabelsForm } from '@/components/client/settings/NavLabelsForm'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Settings → Labels (Tom, 2026-11-11). The project's own
 * names for the sections it has among Blog Posts, Events, Courses, Documents,
 * Testimonials and People, one per dashboard language (`labelLocales`); empty = the default.
 * Shown in the sidebar and as that section's page title, for this project only.
 *
 * Tenant administrators (`site.details.write`: Owner, Site admin); anyone else
 * gets a 404. A support visit sees it read-only unless the client allowed edits.
 */
export const dynamic = 'force-dynamic'

export default async function NavLabelsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/settings/labels`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(NAV_LABELS_WRITE)) notFound()

  // Only the sections this project actually shows.
  const present = new Set(buildClientNavItems(grant).map((i) => i.moduleId))
  const ids = CUSTOM_LABEL_IDS.filter((id) => present.has(id))
  // Every dashboard language (Tom, 2026-11-11): English, Italian, German, French — the current one first in the form.
  const locales = labelLocales()
  const defaults = Object.fromEntries(
    await Promise.all(
      locales.map(async (locale) => {
        const t = await getTranslations({ locale, namespace: 'clientDashboard.nav' })
        return [locale, Object.fromEntries(ids.map((id) => [id, t(id)]))] as const
      }),
    ),
  )

  return (
    <PageShell>
      <NavLabelsForm
        projectSlug={projectSlug}
        ids={ids}
        locales={locales}
        defaults={defaults}
        initial={await loadNavLabels(grant.projectId)}
        canWrite={!(ctx.support && !ctx.support.writesAllowed)}
      />
    </PageShell>
  )
}
