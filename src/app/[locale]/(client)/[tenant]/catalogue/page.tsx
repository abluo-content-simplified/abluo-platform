import { redirect } from 'next/navigation'
import { catalogueRedirectTarget } from '@/lib/modules/catalogue-routes'

/**
 * `/catalogue` is not a screen any more (ADR-042 N2a): it redirects to
 * Catalogue → Items, the default destination. Old deep links keep working: the
 * former `?view=collections` / `?view=optionLists` go to their own routes, and
 * the list filters (`status`, `sort`) travel along.
 */
export const dynamic = 'force-dynamic'

export default async function CatalogueIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  redirect(catalogueRedirectTarget(projectSlug, await searchParams))
}
