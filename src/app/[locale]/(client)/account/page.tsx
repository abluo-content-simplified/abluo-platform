import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { APP_TEXT_SIZE_COOKIE, APP_THEME_COOKIE, parseAppTextSize, parseAppTheme } from '@/lib/app-theme'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { dashboardHomeHref, resolveProjectGrant } from '@/lib/modules/client-navigation'
import { Link } from '@/i18n/navigation'
import { filterSwitchableProjects, loadProjectSummaries, statusesOf } from '@/lib/client/switchable-projects'
import { AppTextSizeSwitch } from '@/components/client/AppTextSizeSwitch'
import { AppThemeSwitch } from '@/components/client/AppThemeSwitch'
import { SignOutButton } from '@/components/client/account/SignOutButton'
import { TwoFactorPill } from '@/components/client/people/people-bits'
import { FactRow } from '@/components/client/ui/FactRow'
import { PageHeader } from '@/components/client/ui/PageHeader'
import { PageShell } from '@/components/client/ui/PageShell'

/**
 * The signed-in person's own Account page (ADR-029 §6 Phase 1) — about THEM,
 * never about a project: profile (read-only for now), how the app looks to
 * them, whether 2-step verification is on, and sign out. Switching project is
 * the project switcher's job, so no project list lives here any more.
 *
 * This route sits outside `[tenant]`, so it renders without the sidebar; a
 * "Back to dashboard" link returns to the last-used project (cookie
 * `abluo_last_project` if still granted, else the first grant — the same rule
 * as the bare dashboard entry).
 *
 * Authentication is checked inline (the `(client)` layout does it too); what
 * is shown here is read AS the user, so it can only ever be their own.
 */
function Section({ id, title, hint, children }: { id?: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {hint ? <p className="-mt-2 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="rounded-2xl border border-border bg-card px-4 py-3 md:px-5">{children}</div>
    </section>
  )
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const ctx = await getTenantAuthorizationContext()

  if (!ctx) {
    redirect(`/login?next=${encodeURIComponent(`/${locale}/account`)}`)
  }

  const [t, tRoles, viewer, jar, summaries] = await Promise.all([
    getTranslations('account'),
    getTranslations('clientDashboard.people.roles'),
    getViewerAccount(ctx.userId),
    cookies(),
    loadProjectSummaries(ctx.projects.map((g) => g.projectId)),
  ])
  // Every site this person works on, with their role there (inactive fixtures left out).
  const access = filterSwitchableProjects(ctx.projects, statusesOf(summaries)).map((g) => ({
    slug: g.projectSlug,
    name: summaries[g.projectId]?.name?.trim() || g.projectSlug,
    role: tRoles.has(g.role) ? tRoles(g.role) : g.role,
  }))
  const theme = parseAppTheme(jar.get(APP_THEME_COOKIE)?.value)
  const textSize = parseAppTextSize(jar.get(APP_TEXT_SIZE_COOKIE)?.value)

  const lastSlug = jar.get('abluo_last_project')?.value
  const home = (lastSlug && resolveProjectGrant(ctx.projects, lastSlug)) || ctx.projects[0]

  return (
    <main className="p-4 md:p-6">
      <PageShell>
        {home ? (
          <Link
            href={dashboardHomeHref(home.projectSlug)}
            className="inline-flex min-h-11 items-start gap-1.5 rounded-md py-2.5 pr-2 text-[0.9375rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5">
              <path d="m15 6-6 6 6 6" />
            </svg>
            {t('back')}
          </Link>
        ) : null}
        <PageHeader title={t('title')} />

        <div className="max-w-xl space-y-6">
          <Section title={t('profile')}>
            <dl>
              <FactRow label={t('name')}>{viewer.name || <span className="text-muted-foreground">{t('notSet')}</span>}</FactRow>
              <FactRow label={t('email')}>{viewer.email}</FactRow>
            </dl>
          </Section>

          {access.length > 0 ? (
            <Section title={t('access')} hint={t('accessHint')}>
              <dl>
                {access.map((a) => (
                  <FactRow key={a.slug} label={a.name}>
                    {a.role}
                  </FactRow>
                ))}
              </dl>
            </Section>
          ) : null}

          <Section id="preferences" title={t('preferences')}>
            <div className="space-y-4 py-1">
              <AppThemeSwitch initial={theme} />
              <AppTextSizeSwitch initial={textSize} />
            </div>
          </Section>

          {viewer.twoFactor !== null ? (
            <Section title={t('security')}>
              <dl>
                <FactRow label={t('twoStep')}>
                  <TwoFactorPill on={viewer.twoFactor} />
                </FactRow>
              </dl>
            </Section>
          ) : null}

          <SignOutButton className="inline-flex min-h-11 items-start rounded-md border border-border bg-card px-4 py-3 text-[0.9375rem] font-medium text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />
        </div>
      </PageShell>
    </main>
  )
}
