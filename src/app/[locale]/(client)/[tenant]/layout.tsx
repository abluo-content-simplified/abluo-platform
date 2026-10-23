import { cookies } from 'next/headers'
import { navSegmentsFor } from '@/lib/client/surfaces'
import { stopwatch, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { notFound, redirect } from 'next/navigation'
import { APP_TEXT_SIZE_COOKIE, APP_THEME_COOKIE, parseAppTextSize, parseAppTheme } from '@/lib/app-theme'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getViewerAccount } from '@/lib/api/viewer-account'
import {
  buildClientNavItems,
  dashboardHomeHref,
  resolveProjectGrant,
} from '@/lib/modules/client-navigation'
import { filterSwitchableProjects, loadProjectSummaries, statusesOf } from '@/lib/client/switchable-projects'
import { ClientSidebar } from '@/components/client/ClientSidebar'
import { AddContentRoot } from '@/components/client/create/AddContentRoot'
import { UploadsProvider } from '@/components/client/media/UploadsProvider'
import { buildCreateMenu } from '@/lib/modules/add-content-sheet'
import { getLocale, getTranslations } from 'next-intl/server'
import { loadWhatsNewFeed } from '@/lib/whats-new/client-feed'
import { loadClientNotices } from '@/lib/whats-new/notices-feed'
import { AnnouncementBanners } from '@/components/client/whats-new/AnnouncementBanners'
import { NewVersionNotice } from '@/components/system/NewVersionNotice'
import { PresenceHeartbeat } from '@/components/system/PresenceHeartbeat'
import { can } from '@/lib/authz/check'
import { SUPPORT_EDIT_MINUTES } from '@/lib/support/constants'
import { listSupportNotices } from '@/lib/support/server'
import { ticketAccess } from '@/lib/support-tickets/access'
import { countClientUnread } from '@/lib/support-tickets/service'
import { SupportBanner } from '@/components/client/support/SupportBanner'
import { SupportAccessNotice } from '@/components/client/support/SupportAccessNotice'
import { loadCatalogueNavLabel } from '@/lib/api/catalogue-drafts'

/**
 * Project-scoped client dashboard shell (ADR-017 Phase 2 / task #81).
 *
 * Wraps every `/{locale}/{projectSlug}/…` client-dashboard route. The
 * dynamic folder is named `[tenant]` — NOT `[projectSlug]` — because
 * `(website)/[tenant]` already occupies the `/[locale]/[…]` position and
 * Next.js forbids two different slug names at the same dynamic path. The URL
 * shape Tom locked (`/{locale}/{projectSlug}/…`) is unchanged; only the folder
 * name differs. `params.tenant` carries the projectSlug value.
 *
 * ADR-017 no-silent-substitute rule (Tom's locked decision #1): the projectSlug
 * from the URL is re-validated against `ctx.projects` on EVERY request via
 * `resolveProjectGrant`. An unmatched/ungranted slug is a `notFound()` (404) —
 * never a silent fallback to `ctx.projects[0]`. The URL is authoritative.
 *
 * The sidebar nav comes from the tenant surface registry (ADR-029):
 * `buildClientNavItems(activeGrant)` returns only the destinations this person
 * may see on this project, as localized, href-based items. The signed-in
 * person's own details and the Help link (`ABLUO_HELP_URL`, configuration) go
 * to the account menu.
 *
 * Support mode (ADR-028 §8, docs/engineering/support-mode.md): when the
 * context is an Abluo admin's support visit, the admin's banner sits on top of
 * every page. Otherwise, people who decide on support access (`users.manage`:
 * Owner, Site admin) see pending requests / live access as a notice on top of
 * every page, Home included.
 */
async function ClientProjectLayoutInner({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenant: string }>
}) {
  const { tenant: projectSlug } = await params

  const lap = stopwatch('layout')
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  lap('auth')
  if (!ctx) {
    redirect(`/login?next=/${projectSlug}/home`)
  }

  // Re-validate the URL slug against the caller's grants — never substitute.
  const activeGrant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!activeGrant) {
    notFound()
  }

  const uiLocale = await getLocale()
  // ADR-033 D12: the catalogue's tenant-chosen dashboard name (presentation only).
  const catalogueLabel = activeGrant.enabledModuleIds.includes('catalogue') ? await loadCatalogueNavLabel(activeGrant.projectSlug, uiLocale) : null
  lap('catalogueLabel')
  const navItems = buildClientNavItems(activeGrant).map((i) => (i.moduleId === 'catalogue' && catalogueLabel ? { ...i, label: catalogueLabel } : i))
  const viewer = await getViewerAccount(ctx.userId)
  lap('viewer')
  const summaries = await loadProjectSummaries(ctx.projects.map((grant) => grant.projectId))
  lap('projectSummaries')
  const projects = filterSwitchableProjects(ctx.projects, statusesOf(summaries), activeGrant.projectSlug).map((grant) => ({
    projectSlug: grant.projectSlug,
    name: summaries[grant.projectId]?.name ?? null,
    domain: summaries[grant.projectId]?.domain ?? null,
    segments: navSegmentsFor(grant),
  }))
  // What's new (ADR-030): read as the user (RLS); null when unavailable — never breaks the shell.
  const whatsNew = await loadWhatsNewFeed({
    userId: ctx.userId,
    locale: await getLocale(),
    enabledModuleIds: activeGrant.enabledModuleIds,
  })
  lap('whatsNew')
  // Announcements (migration 045): same defensive read — null when unavailable.
  const notices = await loadClientNotices({
    userId: ctx.userId,
    locale: uiLocale,
    enabledModuleIds: activeGrant.enabledModuleIds,
  })
  lap('notices')
  // Profile panel (Tom, 2026-10-08): every site this person works on, with their role there.
  const tRoles = await getTranslations('app.roles')
  const profile = {
    name: viewer.name,
    email: viewer.email,
    avatarUrl: viewer.avatarUrl,
    twoFactor: viewer.twoFactor,
    access: filterSwitchableProjects(ctx.projects, statusesOf(summaries)).map((g) => ({
      slug: g.projectSlug,
      name: summaries[g.projectId]?.name?.trim() || g.projectSlug,
      role: tRoles.has(g.role) ? tRoles(g.role) : g.role,
    })),
  }
  const support = ctx.support ?? null
  // Support Tickets (ADR-039): requests with news for this person — cheap and fail-safe (0 on any error).
  const ticketAccessForNav = ticketAccess(ctx, activeGrant.projectSlug)
  const supportUnread =
    ticketAccessForNav && !support && navItems.some((i) => i.moduleId === 'support') ? await countClientUnread(ticketAccessForNav).catch(() => 0) : 0
  lap('supportUnread')
  const supportNotices =
    !support && can(ctx, 'users.manage', { kind: 'project', projectId: activeGrant.projectId })
      ? await listSupportNotices(activeGrant.projectId, ctx.userId)
      : []
  lap('supportNotices')
  const jar = await cookies()
  const theme = parseAppTheme(jar.get(APP_THEME_COOKIE)?.value)
  const textSize = parseAppTextSize(jar.get(APP_TEXT_SIZE_COOKIE)?.value)

  return (
    <AddContentRoot
      projectSlug={activeGrant.projectSlug}
      menu={buildCreateMenu(activeGrant)}
      mediaLibrary={navItems.some((i) => i.moduleId === 'media')}
      contactEmail={process.env.ABLUO_CONTACT_EMAIL || null}
    >
      {/* ADR-035: one upload store — photos keep uploading while the person moves between screens. */}
      <UploadsProvider>
      <div className="min-h-screen md:flex">
        <ClientSidebar
          navItems={navItems}
          projects={projects}
          activeSlug={activeGrant.projectSlug}
          account={{
            name: viewer.name,
            email: viewer.email,
            avatarUrl: viewer.avatarUrl,
            theme,
            textSize,
            helpUrl: process.env.ABLUO_HELP_URL || null,
            profileHref: '/account',
            role: activeGrant.role,
            siteName: summaries[activeGrant.projectId]?.name?.trim() || activeGrant.projectSlug,
          }}
          homeHref={dashboardHomeHref(activeGrant.projectSlug)}
          whatsNew={whatsNew?.updates ?? null}
          whatsNewPopup={!support}
          supportUnread={supportUnread}
          reportProblem={Boolean(ticketAccessForNav?.canWrite) && navItems.some((i) => i.moduleId === 'support')}
          profile={profile}
        />
        {/* #client-main: the main scroll container (the floating "+" listens to it and to the window). */}
        <div id="client-main" className="min-h-screen min-w-0 flex-1 md:ml-56">
          {/* A newer Abluo build is live: calm, never reloads by itself. */}
          <NewVersionNotice className="mx-4 mt-4 md:mx-6 md:mt-6" />
          <PresenceHeartbeat />
          {/* Announcements (planned maintenance …) between their start and end. */}
          <AnnouncementBanners notices={notices} />
          {support ? (
            <SupportBanner
              site={support.projectName}
              role={tRoles.has(support.role) ? tRoles(support.role) : support.role}
              status={support.status}
              expiresAt={support.expiresAt}
              contactRequestsHidden={!support.contactRequestsShown && activeGrant.enabledModuleIds.includes('forms')}
            />
          ) : null}
          <main className="p-4 pb-28 md:p-6">
            {supportNotices.length ? (
              <SupportAccessNotice
                projectSlug={activeGrant.projectSlug}
                minutes={SUPPORT_EDIT_MINUTES}
                notices={supportNotices.map((n) => ({ sessionId: n.sessionId, status: n.status, adminName: n.adminName, expiresAt: n.expiresAt }))}
              />
            ) : null}
            {children}
            {perfBeacon()}
          </main>
        </div>
      </div>
      </UploadsProvider>
    </AddContentRoot>
  )
}

export default function ClientProjectLayout(props: Parameters<typeof ClientProjectLayoutInner>[0]) {
  return traced('dashboard.layout', () => ClientProjectLayoutInner(props))
}
