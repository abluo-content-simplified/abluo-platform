import { notFound, redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { DOCUMENTS_DELETE_PERMISSION, DOCUMENTS_MANAGE_PERMISSION, DOCUMENTS_READ_PERMISSION, loadDocumentsDashboard } from '@/lib/access/documents-dashboard'
import { DOCUMENTS_MODULE_ID } from '@/lib/access/model'
import { PageShell } from '@/components/app/ui/PageShell'
import { DocumentsBrowser } from '@/components/client/documents/DocumentsBrowser'

export const dynamic = 'force-dynamic'

/**
 * Client dashboard — Documents (ADR-040 §15, R9): the files visitors can view
 * or download, their languages, who can open each and the pages it shows on.
 *
 * `documents.document.read` on THIS project, with the Documents module
 * installed; anyone else gets a 404. Changing anything needs
 * `documents.document.manage` and is re-checked by every action.
 */
export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const tab = (await searchParams).tab
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/document-library`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes(DOCUMENTS_MODULE_ID) || !grant.permissions.includes(DOCUMENTS_READ_PERMISSION)) notFound()

  const locale = await getLocale()
  let data
  try {
    data = await loadDocumentsDashboard(ctx, grant.projectId, locale)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <DocumentsBrowser
        projectSlug={projectSlug}
        data={data}
        canManage={grant.permissions.includes(DOCUMENTS_MANAGE_PERMISSION) && !ctx.support}
        canDelete={grant.permissions.includes(DOCUMENTS_DELETE_PERMISSION) && !ctx.support}
        supportVisit={Boolean(ctx.support)}
        initialTab={tab === 'pages' ? 'pages' : 'documents'}
      />
    </PageShell>
  )
}
