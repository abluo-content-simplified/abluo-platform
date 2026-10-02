import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { resolveAdminAccess } from '@/lib/api/auth'

/**
 * Defence in depth for the admin dashboard. `src/proxy.ts` already gates every
 * admin surface on `abluo_admin` + two-factor (AAL2), but these pages read
 * with the SERVICE ROLE (e.g. `dashboard/page.tsx`), so they must not depend on
 * a middleware matcher alone being right. Same decision, same helper as every
 * admin API route (`resolveAdminAccess` → `admin-assurance.ts`).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { decision } = await resolveAdminAccess()
  if (decision === 'login') redirect('/login')
  if (decision === 'unauthorized') redirect('/unauthorized')
  if (decision === 'mfa') redirect('/mfa')

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <AdminSidebar />
      <div className="flex-1 ml-52 min-h-screen">
        {children}
      </div>
    </div>
  )
}
