import { notFound, redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { DOCUMENTS_MANAGE_PERMISSION, DOCUMENTS_READ_PERMISSION, loadDocumentsDashboard } from '@/lib/access/documents-dashboard'
import { DOCUMENTS_MODULE_ID } from '@/lib/access/model'
import { PageShell } from '@/components/app/ui/PageShell'
import { DocumentEditor } from '@/components/client/documents/DocumentEditor'

export const dynamic = 'force-dynamic'

/** Client dashboard — Documents: one document (details, file(s), who can open it, pages) (ADR-040 §15). */
export default async function DocumentEditorPage({ params }: { params: Promise<{ tenant: string; documentId: string }> }) {
  const p = await params
  const projectSlug = p.tenant
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/document-library`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes(DOCUMENTS_MODULE_ID) || !grant.permissions.includes(DOCUMENTS_READ_PERMISSION)) notFound()
  const canManage = grant.permissions.includes(DOCUMENTS_MANAGE_PERMISSION) && !ctx.support

  const locale = await getLocale()
  let data
  try {
    data = await loadDocumentsDashboard(ctx, grant.projectId, locale)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  if (data.notReady) redirect(`/${projectSlug}/document-library`)
  const document = data.documents.find((d) => d.id === p.documentId.toLowerCase())
  if (!document) notFound()

  return (
    <PageShell>
      <DocumentEditor projectSlug={projectSlug} data={data} document={document} canManage={canManage} supportVisit={Boolean(ctx.support)} />
    </PageShell>
  )
}
