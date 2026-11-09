import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { SETTINGS_READ, SettingsError, loadSettings } from '@/lib/settings/service'
import { SocialProfilesForm } from '@/components/client/settings/SocialProfilesForm'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Settings → Social Profiles (ADR-049 Amendment A, Tom
 * 2026-11-09). The website's social profiles — `siteConfig.socialLinks`, the
 * same data Website Settings edits in Studio — shown in the footer and on the
 * Digital Cards (on by default there). The client adds, edits, removes and
 * reorders them; a save is live at once (see saveSocialProfilesAction).
 *
 * Needs `site.details.read` (Owner, Site admin, Editor); only Owner and Site
 * admin (`site.details.write`) can change them, and a support visit only once
 * the client allowed edits. Anyone else gets a 404.
 */
export const dynamic = 'force-dynamic'

export default async function SocialProfilesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/settings/social-profiles`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(SETTINGS_READ)) notFound()

  let view
  try {
    view = await loadSettings(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof SettingsError && error.code === 'not_found') notFound()
    throw error
  }

  return (
    <PageShell>
      <SocialProfilesForm
        projectSlug={projectSlug}
        rev={view.rev}
        initial={view.socialLinks}
        canWrite={view.canWrite && !(ctx.support && !ctx.support.writesAllowed)}
      />
    </PageShell>
  )
}
