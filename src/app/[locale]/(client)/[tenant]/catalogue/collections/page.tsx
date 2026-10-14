import { redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'

/** `/catalogue/collections` — the list lives on the catalogue screen (its Collections view). */
export default async function CollectionsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  redirect(`/${projectSlug}/catalogue?view=collections`)
  return <PageShell>{null}</PageShell>
}
