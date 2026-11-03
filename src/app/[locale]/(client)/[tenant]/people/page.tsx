import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  listPersons,
  PEOPLE_ANONYMISE_PERMISSION,
  PEOPLE_ARCHIVE_PERMISSION,
  PEOPLE_DELETE_PERMISSION,
  PEOPLE_READ_PERMISSION,
  PEOPLE_WRITE_PERMISSION,
  type PersonListItem,
  type PersonSite,
} from '@/lib/api/persons'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { loadGroupTerms } from '@/lib/api/persons-groups'
import { PeopleBrowser } from '@/components/client/persons/PeopleBrowser'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — People (ADR-043 D8), in the shared page frame: the
 * project's people as a table (or cards) with the shared list toolbar. Reads
 * through `listPersons` (people.person.read, project-scoped); a project
 * without the People module gets a 404 like any unknown page. Filters live in
 * the query string; `?new=1` opens "New person".
 */
export const dynamic = 'force-dynamic'

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') query.set(k, v)
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/people`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(PEOPLE_READ_PERMISSION)) notFound()

  let persons: PersonListItem[]
  let site: PersonSite
  try {
    const result = await listPersons(ctx, grant.projectId)
    persons = result.persons
    site = result.site
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  const groups = await loadGroupTerms(ctx, grant.projectId)

  return (
    <PageShell>
      <PeopleBrowser
        projectSlug={projectSlug}
        persons={persons}
        defaultLocale={site.defaultLocale}
        groupTerms={groups}
        canWrite={grant.permissions.includes(PEOPLE_WRITE_PERMISSION)}
        canArchive={grant.permissions.includes(PEOPLE_ARCHIVE_PERMISSION)}
        canDelete={grant.permissions.includes(PEOPLE_DELETE_PERMISSION)}
        canAnonymise={grant.permissions.includes(PEOPLE_ANONYMISE_PERMISSION)}
        initialQuery={query.toString()}
      />
    </PageShell>
  )
}
