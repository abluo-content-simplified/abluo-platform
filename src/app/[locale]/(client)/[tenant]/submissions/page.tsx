import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { getDashboardSubmissions, type DashboardSubmission } from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { SubmissionsTable } from './SubmissionsTable'

/**
 * Client dashboard — Submissions (leads). ADR-018 slice 6.
 *
 * Server component: re-validates the URL projectSlug against `ctx.projects` (no
 * silent substitute, ADR-017 decision #1), then reads via
 * `getDashboardSubmissions`, whose `assertModuleAction` gate throws
 * `TenantAuthorizationError` when the forms module isn't installed — surfaced
 * here as a localized state, not a crash. The full view (filter, breakdown,
 * detail, CSV export, status workflow) lives in the client `SubmissionsTable`;
 * this page only fetches (RLS-scoped) and gates. All copy comes from the
 * `clientDashboard` next-intl namespace (Multilingual-First).
 */
export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ tenant: string }>
}) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect(`/login?next=/${projectSlug}/submissions`)
  }

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) {
    notFound()
  }

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard')

  let submissions: DashboardSubmission[] = []
  let moduleNotInstalled = false
  try {
    submissions = await getDashboardSubmissions(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) {
      moduleNotInstalled = true
    } else {
      throw error
    }
  }

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t('submissions.title')}</h1>
      {moduleNotInstalled ? (
        <p className="text-sm text-muted-foreground">{t('submissions.moduleNotInstalled')}</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('submissions.empty')}</p>
      ) : (
        <SubmissionsTable submissions={submissions} projectSlug={projectSlug} locale={locale} />
      )}
    </div>
  )
}
