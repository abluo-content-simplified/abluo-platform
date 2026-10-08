import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  FORMS_SUBMISSION_DELETE_PERMISSION,
  FORMS_SUBMISSION_UPDATE_PERMISSION,
  getDashboardSubmissions,
  type DashboardSubmission,
} from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { SubmissionsBrowser } from '@/components/client/forms/SubmissionsBrowser'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Submissions (leads). ADR-018 slice 6.
 *
 * Server component: re-validates the URL projectSlug against `ctx.projects` (no
 * silent substitute, ADR-017 decision #1), then reads via
 * `getDashboardSubmissions`, whose `assertModuleAction` gate throws
 * `TenantAuthorizationError` when the forms module isn't installed — surfaced
 * here as a localized state, not a crash. The page renders the shared frame
 * (PageShell + PageHeader); the list (toolbar, table / phone cards, selection
 * bar, detail panel, summary, CSV export, status workflow) lives in the client
 * `SubmissionsBrowser` (components/client/forms). This page only fetches
 * (RLS-scoped) and gates. All copy comes from the
 * `clientDashboard` next-intl namespace (Multilingual-First).
 */
export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ tenant: string }>
}) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
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
    <PageShell>
      <PageHeader title={t('submissions.title')} />
      {moduleNotInstalled ? (
        <p className="text-sm text-muted-foreground">{t('submissions.moduleNotInstalled')}</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('submissions.empty')}</p>
      ) : (
        <SubmissionsBrowser
          submissions={submissions}
          projectSlug={projectSlug}
          locale={locale}
          // UI hints only (ADR-028): hide controls the caller can't use. The
          // server actions re-check the same permissions and RLS enforces them.
          canUpdate={grant.permissions.includes(FORMS_SUBMISSION_UPDATE_PERMISSION)}
          canDelete={grant.permissions.includes(FORMS_SUBMISSION_DELETE_PERMISSION)}
        />
      )}
    </PageShell>
  )
}
