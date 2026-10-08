import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Pill } from '@/components/app/ui/list/cells'
import { NewProjectWizard, type LocaleOption } from '@/components/admin/projects/NewProjectWizard'
import { ProvisioningRunPanel } from '@/components/admin/projects/ProvisioningRunPanel'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { recordAdminAudit } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/provisioning/model'
import { loadClientOptions, loadDesignSystemOptions } from '@/lib/admin/provisioning/options'
import { listUnfinishedRuns, loadRun, rowToRunView } from '@/lib/admin/provisioning/store'
import { LOCALE_CODES, PLATFORM_LOCALES, type SupportedLocale } from '@/lib/i18n/locales'
import { routing } from '@/i18n/routing'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanityServerReadClient } from '@/lib/sanity/server-clients'

export const dynamic = 'force-dynamic'

/**
 * Admin "New project" (docs/engineering/new-project-wizard.md). Without
 * `?run=` it shows the wizard and any unfinished setups; with `?run=<id>` it
 * shows that run (steps, Retry, next steps). Reads with the SERVICE ROLE and
 * the Sanity token, so it checks `requireAbluoAdmin()` itself on top of the
 * `(admin)` layout gate. Every view of a run is written to the audit log.
 */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ run?: string | string[] }> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const t = await getTranslations('admin.newProject')
  const { run: runParam } = await searchParams
  const db = createAdminClient()

  const header = (
    <>
      <Link
        href="/projects"
        className="-my-2 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        {t('back')}
      </Link>
      <div className="space-y-1">
        <PageHeader title={t('title')} />
        <p className="max-w-[672px] text-sm text-muted-foreground">{t('description')}</p>
      </div>
    </>
  )

  if (typeof runParam === 'string' && isUuid(runParam)) {
    const loaded = await loadRun(db, runParam)
    if (!loaded.ok && loaded.error === 'not_found') notFound()
    if (!loaded.ok) {
      return (
        <PageShell>
          {header}
          <EmptyState title={t(loaded.error === 'not_set_up' ? 'notSetUp.title' : 'loadError')} body={loaded.error === 'not_set_up' ? t('notSetUp.body') : undefined} />
        </PageShell>
      )
    }
    const row = loaded.row
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'project.provision.view',
      projectId: row.steps?.['supabase.project']?.status === 'done' ? row.project_id : null,
      detail: { runId: row.id, projectSlug: row.project_slug },
    })
    return (
      <PageShell>
        {header}
        <ProvisioningRunPanel key={`${row.id}-${row.updated_at}`} run={rowToRunView(row)} />
      </PageShell>
    )
  }

  const [unfinished, clients, designSystems] = await Promise.all([listUnfinishedRuns(db), loadClientOptions(db), loadDesignSystemOptions(sanityServerReadClient)])

  if (!unfinished.ok && unfinished.error === 'not_set_up') {
    return (
      <PageShell>
        {header}
        <EmptyState title={t('notSetUp.title')} body={t('notSetUp.body')} />
      </PageShell>
    )
  }

  const locales: LocaleOption[] = LOCALE_CODES.map((code) => ({ code, label: PLATFORM_LOCALES[code].nativeName }))
  const defaultLocale: SupportedLocale = routing.defaultLocale

  return (
    <PageShell>
      {header}

      {unfinished.ok && unfinished.rows.length ? (
        <section aria-labelledby="np-unfinished" className="flex max-w-[672px] flex-col gap-3">
          <SectionHeading id="np-unfinished" title={t('unfinished.heading')} />
          <ul className="flex flex-col gap-2">
            {unfinished.rows.map((r) => {
              const v = rowToRunView(r)
              return (
                <li key={r.id}>
                  <Link
                    href={`/projects/new?run=${r.id}`}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[0.9375rem] leading-6 font-semibold text-foreground">{v.projectName}</span>
                      <span className="text-sm leading-5 break-all text-muted-foreground">
                        {v.tenantName} · <span className="font-mono">{v.projectSlug}</span>
                      </span>
                    </span>
                    <Pill tone={v.status === 'failed' ? 'outline' : 'muted'}>{t(`run.status.${v.status}`)}</Pill>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {clients === null || designSystems === null ? (
        <div role="alert" className="max-w-[672px] rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
          {t(clients === null ? 'clientsError' : 'designSystemsError')}
        </div>
      ) : (
        <NewProjectWizard clients={clients} designSystems={designSystems} locales={locales} defaultLocale={defaultLocale} />
      )}
    </PageShell>
  )
}
