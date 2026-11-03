import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  getPersonForEdit,
  isPersonId,
  PEOPLE_ANONYMISE_PERMISSION,
  PEOPLE_ARCHIVE_PERMISSION,
  PEOPLE_DELETE_PERMISSION,
  PEOPLE_READ_PERMISSION,
  PEOPLE_WRITE_PERMISSION,
  PersonError,
  type PersonSnapshot,
} from '@/lib/api/persons'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { loadGroupTerms } from '@/lib/api/persons-groups'
import { PersonEditor } from '@/components/client/persons/PersonEditor'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * One person's editor (client dashboard · People, ADR-043 D8), in the shared
 * page frame. Shows the draft when there is one, else the published person;
 * GET never creates a draft (the editor opens one on the first change). Needs
 * people.person.read; without people.person.write the editor is read-only.
 * Anything not this project's person is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function PersonPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/people/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isPersonId(id) || !grant.permissions.includes(PEOPLE_READ_PERMISSION)) notFound()

  let person: PersonSnapshot
  try {
    person = await getPersonForEdit(ctx, grant.projectId, id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof PersonError && error.code === 'not_found') notFound()
    throw error
  }
  const groups = await loadGroupTerms(ctx, grant.projectId)

  return (
    <PageShell>
      <PersonEditor
        key={person.id}
        projectSlug={projectSlug}
        initial={person}
        groupTerms={groups}
        canWrite={grant.permissions.includes(PEOPLE_WRITE_PERMISSION)}
        canArchive={grant.permissions.includes(PEOPLE_ARCHIVE_PERMISSION)}
        canDelete={grant.permissions.includes(PEOPLE_DELETE_PERMISSION)}
        canAnonymise={grant.permissions.includes(PEOPLE_ANONYMISE_PERMISSION)}
        canAddGroup={grant.permissions.includes('people.taxonomy.write')}
        canTranslate={grant.enabledModuleIds.includes('translate')}
      />
    </PageShell>
  )
}
