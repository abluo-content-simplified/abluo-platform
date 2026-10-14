import { redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'

/** `/catalogue/option-lists` — the list lives on the catalogue screen (its Option lists view). */
export default async function OptionListsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  redirect(`/${projectSlug}/catalogue?view=optionLists`)
  return <PageShell>{null}</PageShell>
}
