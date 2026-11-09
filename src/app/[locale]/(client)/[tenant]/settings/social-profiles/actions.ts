'use server'

/**
 * Client dashboard — Settings → Social Profiles server action (ADR-049
 * Amendment A, 2026-11-09). Its own file: the Settings page itself imports no
 * `lib/settings` code (no-affiliate.test.ts).
 */
import { revalidatePath } from 'next/cache'
import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { SettingsError, saveSettings, type SettingsErrorCode } from '@/lib/settings/service'
import { SOCIAL_LINKS_PATH } from '@/lib/settings/paths'

export type SocialProfilesActionError = 'unauthenticated' | 'forbidden' | SettingsErrorCode
export type SocialProfilesActionResult = { ok: true; rev: string } | { ok: false; error: SocialProfilesActionError }

/**
 * Settings → Social Profiles: saves the website's whole list of social
 * profiles (`siteConfig.socialLinks`, the same field Website Settings edits
 * in Studio). Every check is in `src/lib/settings/service.ts` — the same
 * writer Connected Apps uses: `site.details.write`, the allow-listed path
 * (`paths.ts`, URLs https on the right platform), the single-project guard,
 * the revision guard (`conflict`), the PUBLISHED document patched together
 * with any Studio draft — so a client change is live at once ("Publish =
 * online") and the next Studio Publish cannot bring the old list back.
 */
export async function saveSocialProfilesAction(input: { projectSlug: string; rev: string; socialLinks: unknown }): Promise<SocialProfilesActionResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  try {
    const r = await saveSettings(access.ctx, access.grant.projectId, { rev: input?.rev, set: { [SOCIAL_LINKS_PATH]: input?.socialLinks } })
    try {
      revalidatePath('/[locale]/[tenant]/settings/social-profiles', 'page')
      revalidatePath('/[locale]/[tenant]', 'layout')
    } catch {
      /* not in a request (tests) — nothing to refresh */
    }
    return { ok: true, rev: r.rev }
  } catch (error) {
    if (error instanceof SettingsError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
