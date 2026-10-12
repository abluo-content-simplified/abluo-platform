import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { PartnersBrowser } from '@/components/admin/partners/PartnersBrowser'
import { PageShell } from '@/components/app/ui/PageShell'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { listPartnerApps } from '@/lib/connections/admin'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'

export const dynamic = 'force-dynamic'

/**
 * Admin — Partner apps (ADR-031 D8.2): register, approve and suspend the apps
 * that may ask a client to connect (TableRes first), and see every
 * Connection across clients. Reads with the SERVICE ROLE, so besides the
 * `(admin)` layout gate it checks `requireAbluoAdmin()` itself; the data
 * layer checks `partners.manage` again. Secrets are shown once, never listed.
 */
export default async function AdminPartnersPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')
  const t = await getTranslations('admin.partners')
  const r = await listPartnerApps({ ...actor, projects: [] }, { store: createSupabaseConnectionsStore() })
  if (!r.ok) redirect('/unauthorized')
  return (
    <PageShell>
      <PartnersBrowser title={t('title')} apps={r.apps} />
    </PageShell>
  )
}
