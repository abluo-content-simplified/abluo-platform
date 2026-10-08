'use server'

/**
 * "View as client" — opens a support visit (ADR-028 §8, docs/engineering/support-mode.md).
 *
 * Admin-only: `requireAbluoAdmin()` (abluo_admin + two-factor) runs first and
 * refuses anything else. The visit row is written with the service role, the
 * httpOnly visit cookie is set on THIS host, `support.visit.start` is logged,
 * and the admin lands on the client's Home for that project. From there every
 * request re-checks admin + AAL2 + an open visit (getTenantAuthorizationContext).
 */
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { DEFAULT_SUPPORT_ROLE, isSupportRole } from '@/lib/support/constants'
import { startSupportVisit } from '@/lib/support/server'

export async function startSupportVisitAction(formData: FormData): Promise<void> {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')

  const locale = await getLocale()
  const projectId = formData.get('projectId')
  const backSlug = formData.get('slug')
  const role = formData.get('role')
  const back = (code: string) =>
    redirect(`/${locale}/projects/${encodeURIComponent(typeof backSlug === 'string' ? backSlug : '')}?support=${code}`)

  if (typeof projectId !== 'string') back('failed')
  const result = await startSupportVisit(actor, projectId as string, isSupportRole(role) ? role : DEFAULT_SUPPORT_ROLE)
  if (!result.ok) back(result.error === 'unavailable' ? 'unavailable' : 'failed')
  else redirect(`/${locale}/${encodeURIComponent(result.project.slug)}/home`)
}
