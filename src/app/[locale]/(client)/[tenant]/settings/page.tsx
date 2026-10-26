import { redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/settings` — moved (Tom, 2026-10-26): the affiliate programs and the
 * disclosure text now live in Connected Apps, as cards. Old links and
 * bookmarks land there. The route stays for contact and legal details later.
 */
export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  redirect(`/${projectSlug}/apps`)
  return <PageShell>{null}</PageShell>
}
