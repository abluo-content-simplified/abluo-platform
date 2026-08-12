import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { getDashboardSubmissions, type DashboardSubmission } from '@/lib/api/client-dashboard'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

/**
 * Client dashboard — Submissions (leads). ADR-018 slice 6.
 *
 * Wires `form_submissions` into the client dashboard. Mirrors the Posts page:
 * re-validates the URL projectSlug against `ctx.projects` (no silent substitute,
 * ADR-017 decision #1), then reads via `getDashboardSubmissions`, whose
 * `assertModuleAction` gate throws `TenantAuthorizationError` when the forms
 * module isn't installed for the project — surfaced here as a localized state,
 * not a crash. Read-only this slice; status mutation is a follow-up. All copy
 * comes from the `clientDashboard` next-intl namespace (Multilingual-First).
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
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t('submissions.title')}</h1>
      {moduleNotInstalled ? (
        <p className="text-sm text-muted-foreground">{t('submissions.moduleNotInstalled')}</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('submissions.empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 font-medium">{t('submissions.columns.name')}</th>
              <th className="py-2 font-medium">{t('submissions.columns.email')}</th>
              <th className="py-2 font-medium">{t('submissions.columns.form')}</th>
              <th className="py-2 font-medium">{t('submissions.columns.status')}</th>
              <th className="py-2 font-medium">{t('submissions.columns.received')}</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id} className="border-b border-border/60">
                <td className="py-2 font-medium">{s.name ?? t('submissions.anonymous')}</td>
                <td className="py-2 text-muted-foreground">{s.email ?? '—'}</td>
                <td className="py-2 text-muted-foreground">{s.formId}</td>
                <td className="py-2 text-muted-foreground">{t(`submissions.status.${s.status}`)}</td>
                <td className="py-2 text-muted-foreground">{formatReceived(s.createdAt, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Locale-aware date+time; falls back to the raw ISO string on error. */
function formatReceived(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso
  }
}
